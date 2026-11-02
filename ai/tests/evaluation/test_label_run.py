import json

import numpy as np
import pytest

from dietai.adapters.cache import FileCache
from dietai.adapters.ocr import CachedOcr, image_digest
from dietai.evaluation import (
    label_report_markdown,
    load_label_truth,
    read_label_run,
    read_manifest,
    run_label_ocr,
    summarize_label,
    write_manifest,
)
from dietai.label_parsing import OcrBox
from dietai.preprocess import LabelConfig
from dietai.synthetic import write_label_dataset
from dietai.synthetic.scenes import _LABEL_ROWS

PERFECT = [f"{k.strip()} {v}" for k, v in _LABEL_ROWS]


class FakeOcr:
    """回傳固定的文字行（每行一個框，由上到下），並記錄被呼叫的次數。"""

    def __init__(self, lines, name="fake 1.0"):
        self.lines = lines
        self.name = name
        self.calls = 0

    def __call__(self, img):
        self.calls += 1
        return [OcrBox(t, 0, 30 * i, 100, 20, 0.9) for i, t in enumerate(self.lines)]


@pytest.fixture(scope="module")
def dataset(tmp_path_factory):
    return write_label_dataset(tmp_path_factory.mktemp("labels") / "data", n=3)


def test_synthetic_label_dataset(dataset):
    m = read_manifest(dataset)
    assert len(m.items) == 3 and m.tag_columns == ("source_id", "strength")
    truth = load_label_truth(dataset.parent / m.items[0].truth)
    assert len(truth.cells) == 10 and truth.quad is not None and truth.text


def test_run_scores_every_engine_and_method(dataset, tmp_path):
    m = read_manifest(dataset)
    perfect = FakeOcr(PERFECT)
    sloppy = FakeOcr(["Calories 152 kcal", "Protein 2.7 g"], name="sloppy")
    out = tmp_path / "run"
    seen = []
    summary = run_label_ocr(
        m,
        {"perfect": perfect, "sloppy": sloppy},
        out,
        methods={"raw": None, "rectify": LabelConfig()},
        progress=lambda d, t: seen.append((d, t)),
        label="t",
    )
    assert seen[-1] == (6, 6)
    assert perfect.calls == sloppy.calls == 6  # 3 張 × 2 個方法
    assert summary.counts == {"all_correct": 6, "partial": 6}
    meta, rows = read_label_run(out)
    assert meta["engines"] == {"perfect": "fake 1.0", "sloppy": "sloppy"}
    assert meta["methods"]["raw"] is None and meta["methods"]["rectify"]["enable_rectify"]
    assert len(rows) == 12

    by = {(s["method"], s["engine"]): s for s in summarize_label(rows)}
    assert by["raw", "perfect"]["field_accuracy"] == 1.0
    assert by["raw", "perfect"]["all_correct"] == 1.0
    assert by["raw", "sloppy"]["field_accuracy"] == pytest.approx(0.1)  # 10 格只對熱量
    # 原圖不做定位；校正方法在合成場景上找到正確的四角
    assert by["raw", "perfect"]["located"] is None
    assert by["rectify", "perfect"]["located"] == 1.0
    assert by["rectify", "perfect"]["mean_quad_error"] < 0.02
    sloppy_row = next(r for r in rows if r["engine"] == "sloppy")
    wrong = json.loads(sloppy_row["wrong"])
    assert wrong["protein/per_serving"] == "2.7g" and wrong["fat/per_serving"] == ""

    report = label_report_markdown(meta, rows, ("strength",))
    assert "`perfect`：fake 1.0" in report and "依 `strength` 分組" in report


def test_run_records_errors_and_negatives(tmp_path):
    img = np.full((60, 80, 3), 200, dtype=np.uint8)
    from dietai.evaluation import write_image

    write_image(tmp_path / "a.png", img)
    write_image(tmp_path / "neg.png", img)
    (tmp_path / "bad.json").write_text('{"header": {"weight": "1g"}}', encoding="utf-8")
    rows = [
        {"id": "bad", "image": "a.png", "truth": "bad.json", "split": "dev"},
        {"id": "neg", "image": "neg.png", "truth": "", "split": "dev"},
        {"id": "gone", "image": "missing.png", "truth": "x.json", "split": "dev"},
    ]
    m = read_manifest(write_manifest(tmp_path / "m.csv", rows))
    run_label_ocr(m, {"f": FakeOcr(PERFECT)}, tmp_path / "run")
    _, out = read_label_run(tmp_path / "run")
    got = {r["id"]: r for r in out}
    assert "weight" in got["bad"]["error"] and "missing.png" in got["gone"]["error"]
    # 負樣本：沒有分數，記錄讀到的欄位數（這裡假 OCR 讀到 10 個欄位＝誤讀）
    assert got["neg"]["total"] == "" and got["neg"]["n_fields"] == "10"
    (s,) = summarize_label(out)
    assert (s["errors"], s["negatives"], s["negative_fields"], s["n"]) == (2, 1, 1, 0)


def test_run_refuses_test_split(tmp_path):
    rows = [{"id": "a", "image": "a.png", "truth": "", "split": "test"}]
    m = read_manifest(write_manifest(tmp_path / "m.csv", rows), include_test=True)
    with pytest.raises(ValueError, match="include_test"):
        run_label_ocr(m, {"f": FakeOcr([])}, tmp_path / "o")
    with pytest.raises(ValueError, match="至少"):
        run_label_ocr(m, {}, tmp_path / "o2", include_test=True)


def test_cached_ocr(tmp_path):
    img = np.zeros((10, 20), dtype=np.uint8)
    engine = FakeOcr(["熱量 152 大卡"])
    cached = CachedOcr(engine, FileCache(tmp_path))
    first = cached(img)
    assert cached(img) == first and engine.calls == 1
    assert (cached.hits, cached.misses) == (1, 1)
    # 另一個行程（新的物件）讀同一個快取資料夾也命中
    again = CachedOcr(FakeOcr(["x"]), FileCache(tmp_path))
    assert again(img) == first
    # 引擎名稱（版本、設定）不同就是不同的鍵；影像不同也是
    other = CachedOcr(FakeOcr(["y"], name="fake 2.0"), FileCache(tmp_path))
    assert other(img)[0].text == "y"
    assert image_digest(img) != image_digest(img.reshape(20, 10))
    assert image_digest(img) != image_digest(img + 1)
