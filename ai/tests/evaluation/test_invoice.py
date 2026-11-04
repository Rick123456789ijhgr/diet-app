"""E3 電子發票 QR：真值格式、判定、每個方法都執行與離線逐步升級。"""

import json
from pathlib import Path

import pytest

from dietai.evaluation import (
    Arm,
    InvoiceOutcome,
    format_invoice_truth,
    invoice_report_markdown,
    judge_invoice,
    load_arms,
    parse_invoice_truth,
    read_image,
    read_invoice_methods,
    read_manifest,
    run_invoice_methods,
    simulate_invoice_ladder,
    summarize_invoice,
    write_image,
    write_manifest,
)
from dietai.evaluation.invoice import INVOICE_METHOD_COLUMNS, select_pair
from dietai.preprocess import (
    CodeFormat,
    DecodeHit,
    InvoiceQrConfig,
    LadderConfig,
    locate_invoice_qrs,
)
from dietai.synthetic import invoice_contents, invoice_qr_scene, write_invoice_dataset

CONFIGS = Path(__file__).resolve().parents[3] / "research/experiments/e3_invoice_qr/configs"
L, R = b"LEFT-QR", "**:茶葉蛋:1:10".encode("big5")
TRUTH = frozenset({L, R})


def test_truth_round_trip_keeps_raw_bytes():
    left, right = invoice_contents(1)[0]
    text = format_invoice_truth(left, right)
    assert text.count("|") == 1 and text == text.lower()
    assert parse_invoice_truth(text) == {left, right}
    assert parse_invoice_truth("") is None and parse_invoice_truth("  ") is None


@pytest.mark.parametrize("bad", ["abcd", "ab|", "zz|ab", "ab|ab", "ab|cd|ef"])
def test_truth_rejects_malformed(bad):
    with pytest.raises(ValueError):
        parse_invoice_truth(bad)


@pytest.mark.parametrize(
    ("selected", "truth", "expected"),
    [
        ([L, R], TRUTH, InvoiceOutcome.CORRECT),
        ([R, L], TRUTH, InvoiceOutcome.CORRECT),  # 左右不另判
        ([L], TRUTH, InvoiceOutcome.PARTIAL),
        ([L, b"OTHER"], TRUTH, InvoiceOutcome.MISREAD),  # 任一不一致即誤讀
        ([b"OTHER"], TRUTH, InvoiceOutcome.MISREAD),
        ([], TRUTH, InvoiceOutcome.MISSED),
        ([L], None, InvoiceOutcome.FALSE_POSITIVE),
        ([], None, InvoiceOutcome.TRUE_NEGATIVE),
    ],
)
def test_judge_invoice(selected, truth, expected):
    assert judge_invoice(selected, truth) is expected


def test_select_pair_keeps_two_largest():
    assert select_pair({b"a": 10.0, b"b": 300.0, b"c": 200.0}) == [b"b", b"c"]
    assert select_pair({b"a": 1.0}) == [b"a"]


@pytest.fixture(scope="module")
def dataset(tmp_path_factory):
    out = tmp_path_factory.mktemp("inv")
    return write_invoice_dataset(out, n=2, conditions=("blur", "rotate", "downscale"))


def test_run_writes_table_and_ladder_matches_online(dataset, tmp_path):
    manifest = read_manifest(dataset)
    arms = load_arms(CONFIGS, ["q0_raw", "q1_all_methods"])
    summary = run_invoice_methods(manifest, arms, tmp_path / "run", label="t")
    meta, rows = read_invoice_methods(summary.out_dir)
    assert meta["experiment"] == "e3_invoice_qr" and meta["mode"] == "invoice_methods"
    assert list(rows[0])[: len(INVOICE_METHOD_COLUMNS)] == list(INVOICE_METHOD_COLUMNS)
    n_methods = sum(len(m) for m in meta["methods"].values())
    assert len(rows) == len(manifest.items) * n_methods

    # 未劣化的發票：原圖就讀到兩個；負樣本不誤報
    clean = [r for r in rows if r["condition"] == "clean" and r["method"] == "raw"]
    assert {r["outcome"] for r in clean if r["truth"]} == {"correct"}
    assert {r["outcome"] for r in clean if not r["truth"]} == {"true_negative"}

    # 離線逐步升級與上線的 locate_invoice_qrs 逐張一致（各方法都由原圖獨立處理）
    for arm in arms:
        sim = simulate_invoice_ladder(rows, meta["methods"][arm.name], arm=arm.name)
        decoder = arm.make_decoder()
        cfg = InvoiceQrConfig(ladder=arm.ladder)
        for item, row in zip(manifest.items, sim, strict=True):
            assert row["id"] == item.id
            res = locate_invoice_qrs(read_image(item.image), decoder, cfg)
            online = [h.raw for h in (res.left, res.right) if h is not None]
            assert row["outcome"] == judge_invoice(online, parse_invoice_truth(item.truth))
            assert set(row["decoded"].split("|")) - {""} == {raw.hex() for raw in online}

    # 全方法的逐步升級不會比只用原圖差
    by_arm = {
        s["arm"]: s
        for arm in arms
        for s in summarize_invoice(
            simulate_invoice_ladder(rows, meta["methods"][arm.name], arm=arm.name, name=arm.name),
            "arm",
        )
    }
    assert by_arm["q1_all_methods"]["correct"] >= by_arm["q0_raw"]["correct"]

    report = invoice_report_markdown(meta, rows, ("condition",))
    assert "## 單一方法" in report and "## 逐步升級" in report and "q0_raw:raw" in report


class _FakeDecoder:
    """依序回傳固定的結果：模擬「這一階讀到哪些 QR」。"""

    def __init__(self, hits: list[DecodeHit]) -> None:
        self.hits = hits

    def __call__(self, img):
        return list(self.hits)


def _qr(raw: bytes, size: float) -> DecodeHit:
    corners = ((0.0, 0.0), (size, 0.0), (size, size), (0.0, size))
    return DecodeHit(CodeFormat.QR_CODE, raw.decode("latin-1"), raw, corners)


def _single(tmp_path, truth: str):
    write_image(tmp_path / "a.png", invoice_qr_scene(L, R))
    rows = [{"id": "a", "image": "a.png", "truth": truth, "split": "dev"}]
    return read_manifest(write_manifest(tmp_path / "m.csv", rows, ()))


def test_partial_and_background_qr_and_non_qr(tmp_path):
    manifest = _single(tmp_path, format_invoice_truth(L, R))
    arm = Arm("x", ladder=LadderConfig(rungs=("raw",)))
    hits = [
        _qr(L, 100),
        _qr(b"AD", 10),  # 背景中較小的 QR：只讀到兩個以上時才會被排除
        DecodeHit(CodeFormat.EAN13, "4710088410108", b"4710088410108", _qr(b"", 500).corners),
    ]
    summary = run_invoice_methods(
        manifest, [arm], tmp_path / "r", decoder_factory=lambda a: _FakeDecoder(hits)
    )
    _, rows = read_invoice_methods(summary.out_dir)
    (row,) = rows
    # 非 QR 格式不計；兩個 QR 中 AD 不在真值內 → 誤讀
    assert row["decoded"] == f"{L.hex()}|{b'AD'.hex()}" and row["outcome"] == "misread"

    only_left = run_invoice_methods(
        manifest, [arm], tmp_path / "r2", decoder_factory=lambda a: _FakeDecoder([_qr(L, 9)])
    )
    assert read_invoice_methods(only_left.out_dir)[1][0]["outcome"] == "partial"


def test_bad_truth_is_recorded_as_error(tmp_path):
    manifest = _single(tmp_path, "not-hex|zz")
    arm = Arm("x", ladder=LadderConfig(rungs=("raw", "gray")))
    summary = run_invoice_methods(manifest, [arm], tmp_path / "r")
    _, rows = read_invoice_methods(summary.out_dir)
    assert [r["outcome"] for r in rows] == ["error", "error"]
    assert "hex" in rows[0]["error"]
    (ladder,) = simulate_invoice_ladder(rows, ["raw", "gray"])
    assert ladder["outcome"] == "error"
    assert summarize_invoice(rows)[0]["errors"] == 1


def test_simulate_rejects_unknown_method_and_empty_order(dataset, tmp_path):
    arms = load_arms(CONFIGS, ["q0_raw"])
    summary = run_invoice_methods(read_manifest(dataset), arms, tmp_path / "r")
    _, rows = read_invoice_methods(summary.out_dir)
    with pytest.raises(ValueError):
        simulate_invoice_ladder(rows, [])
    with pytest.raises(ValueError):
        simulate_invoice_ladder(rows, ["raw", "nope"])


def test_dataset_params_and_truth(dataset):
    params = json.loads((dataset.parent.parent / "sources" / "sources.json").read_text("utf-8"))
    assert params["generator"] == "dietai.synthetic.write_invoice_dataset"
    items = read_manifest(dataset).items
    assert {i.tags["condition"] for i in items} == {"clean", "blur", "rotate", "downscale"}
    assert sum(1 for i in items if not i.truth) == 1 + 3 * 4  # 負樣本的 clean 與各變體
