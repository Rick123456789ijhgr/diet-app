"""工作台介面的冒煙測試：以 AppTest 在程序內執行，不啟動瀏覽器或伺服器。"""

import json
from pathlib import Path

import pytest

pytest.importorskip("streamlit")

from streamlit.testing.v1 import AppTest  # noqa: E402

from dietai.devtools.images import encode_png  # noqa: E402
from dietai.preprocess import DEFAULT_RUNGS, RETAIL_FORMATS, Rung  # noqa: E402
from dietai.synthetic import label_scene  # noqa: E402

APP = str(Path(__file__).resolve().parents[2] / "workbench" / "streamlit_app.py")


def _app(page: str | None = None) -> AppTest:
    at = AppTest.from_file(APP, default_timeout=30).run()
    if page is not None:
        at.switch_page(page).run()
    assert not at.exception, at.exception
    return at


def _run_batch(at: AppTest, folder: Path) -> None:
    at.text_input(key="batch.folder").input(str(folder))
    next(b for b in at.button if "執行" in b.label).click().run()
    assert not at.exception, at.exception


@pytest.mark.parametrize(
    "page",
    [
        None,
        "app_pages/quality.py",
        "app_pages/barcode.py",
        "app_pages/label.py",
        "app_pages/food.py",
        "app_pages/sweep.py",
        "app_pages/batch.py",
        "app_pages/e1.py",
        "app_pages/dev_checks.py",
    ],
)
def test_every_page_renders(page):
    _app(page)


def test_home_lists_thresholds():
    at = _app()
    assert len(at.dataframe) == 1
    assert not at.exception


def test_quality_page_with_synthetic_image():
    at = _app("app_pages/quality.py")
    assert any("通過品質檢查" in m.value for m in at.markdown)
    assert len(at.metric) == 4


def test_quality_page_flags_extreme_blur():
    at = _app("app_pages/quality.py")
    at.slider(key="quality.d.blur_sigma").set_value(20.0).run()
    assert not at.exception
    assert any("未通過" in m.value for m in at.markdown)


def test_quality_views_switch():
    at = _app("app_pages/quality.py")
    for view in ("laplacian", "exposure", "histogram"):
        at.segmented_control(key="quality.view").set_value(view).run()
        assert not at.exception, view


def test_quality_page_rejects_invalid_config():
    at = _app("app_pages/quality.py")
    at.number_input(key="cfg.quality.dark_level").set_value(250).run()
    assert any("參數不合法" in e.value for e in at.error)


def test_config_changes_sync_to_query_params():
    at = _app("app_pages/quality.py")
    at.number_input(key="cfg.quality.blur_min").set_value(150.0).run()
    assert at.query_params.get("quality.blur_min") == "150.0"
    at.button(key="cfg.quality.reset").click().run()
    assert "quality.blur_min" not in at.query_params


def test_sweep_page_reports_trigger_levels():
    at = _app("app_pages/sweep.py")
    at.slider(key="sweep.n").set_value(5).run()
    assert not at.exception
    blurry = next(m for m in at.metric if "過於模糊" in m.label)
    assert blurry.value.startswith("≥")


def test_batch_rejects_test_split(tmp_path):
    at = _app("app_pages/batch.py")
    _run_batch(at, tmp_path / "splits" / "test")
    assert any("測試集已鎖定" in e.value for e in at.error)


def test_batch_runs_on_folder(tmp_path):
    for i in range(3):
        (tmp_path / f"{i}.png").write_bytes(encode_png(label_scene(240, 320, seed=i)))
    at = _app("app_pages/batch.py")
    _run_batch(at, tmp_path)
    assert at.metric[0].value == "3"


def test_barcode_page_decodes_synthetic_ean13():
    at = _app("app_pages/barcode.py")
    assert any("解碼成功" in m.value for m in at.markdown)
    assert any(m.value == "4710088410108" for m in at.metric)


def test_barcode_page_ladder_rescues_rotation():
    at = _app("app_pages/barcode.py")
    at.slider(key="barcode.d.rotate_deg").set_value(45.0).run()
    assert not at.exception, at.exception
    assert any("解碼成功" in m.value for m in at.markdown)
    assert any("只用原圖：失敗" in c.value for c in at.caption)


def test_barcode_page_rung_view_and_raw_only():
    at = _app("app_pages/barcode.py")
    at.multiselect(key="barcode.rungs").set_value([]).run()
    at.multiselect(key="barcode.rungs").select("raw").run()
    at.slider(key="barcode.d.rotate_deg").set_value(45.0).run()
    assert any("解碼失敗" in m.value for m in at.markdown)
    at.segmented_control(key="barcode.view").set_value("rung").run()
    assert not at.exception, at.exception


def test_barcode_page_rejects_empty_scales():
    at = _app("app_pages/barcode.py")
    at.multiselect(key="barcode.scales").set_value([]).run()
    assert any("參數不合法" in e.value for e in at.error)


def test_invoice_mode_finds_both_qrs():
    at = _app("app_pages/barcode.py")
    at.segmented_control(key="barcode.mode").set_value("invoice").run()
    assert not at.exception, at.exception
    assert any("找到左右兩碼" in m.value for m in at.markdown)


def test_barcode_page_pyzbar_engine():
    pytest.importorskip("pyzbar.pyzbar")
    at = _app("app_pages/barcode.py")
    at.segmented_control(key="barcode.engine").set_value("pyzbar").run()
    assert not at.exception, at.exception


def test_ladder_reset_restores_rungs_and_scales():
    at = _app("app_pages/barcode.py")
    at.multiselect(key="barcode.rungs").set_value(["raw"]).run()
    at.multiselect(key="barcode.scales").set_value([3.0]).run()
    at.button(key="cfg.ladder.reset").click().run()
    assert not at.exception, at.exception
    assert at.multiselect(key="barcode.rungs").value == list(DEFAULT_RUNGS)
    assert at.multiselect(key="barcode.scales").value == [2.0, 0.5]
    assert at.multiselect(key="barcode.formats").value == list(RETAIL_FORMATS)


def test_ladder_json_import_restores_rungs_and_scales():
    at = _app("app_pages/barcode.py")
    payload = {
        "class": "LadderConfig",
        "values": {"rungs": ["deskew", "raw"], "scales": [1.25], "binarize_c": 7.0},
    }
    data = json.dumps(payload).encode()
    at.file_uploader(key="cfg.ladder.import").set_value(("cfg.json", data, "application/json"))
    at.run()
    assert not at.exception, at.exception
    assert at.multiselect(key="barcode.rungs").value == [Rung.DESKEW, Rung.RAW]
    assert at.multiselect(key="barcode.scales").value == [1.25]  # 不在預設選項中的倍率
    assert at.number_input(key="cfg.ladder.binarize_c").value == 7.0
    assert any("LadderConfig(rungs=" in c.value for c in at.code)


def test_sweep_barcode_target_compares_raw_and_ladder():
    at = _app("app_pages/sweep.py")
    at.segmented_control(key="sweep.target").set_value("barcode").run()
    at.selectbox(key="sweep.axis").set_value("rotate_deg").run()
    at.slider(key="sweep.n").set_value(3).run()
    at.number_input(key="sweep.samples").set_value(2).run()
    assert not at.exception, at.exception
    raw = next(m for m in at.metric if "只用原圖" in m.label)
    ladder = next(m for m in at.metric if "逐步升級" in m.label)
    assert int(ladder.value.rstrip("%")) > int(raw.value.rstrip("%"))


def test_label_page_locates_synthetic_label():
    at = _app("app_pages/label.py")
    assert any("處理完成" in m.value for m in at.markdown)
    method = next(m for m in at.metric if "定位方法" in m.label)
    assert "輪廓法" in method.value
    error = next(m for m in at.metric if "四角平均誤差" in m.label)
    assert float(error.value.removesuffix(" px")) < 10


def test_label_page_views_switch():
    at = _app("app_pages/label.py")
    for view in ("edges", "glare", "output"):
        at.segmented_control(key="label.view").set_value(view).run()
        assert not at.exception, view


def test_label_page_large_glare_requests_retake():
    at = _app("app_pages/label.py")
    at.slider(key="label.d.glare").set_value(0.2).run()
    assert not at.exception, at.exception
    assert any("有警告" in m.value for m in at.markdown)
    glare = next(m for m in at.metric if "光斑比例" in m.label)
    assert float(glare.value.rstrip("%")) > 10  # 超過預設上限 glare_max_ratio
    error = next(m for m in at.metric if "四角平均誤差" in m.label)
    assert error.value == "—"  # 套用退化後沒有真值


def test_label_page_gray_output_and_steps_off():
    at = _app("app_pages/label.py")
    at.toggle(key="cfg.label.clahe_on_lab").set_value(False).run()
    at.segmented_control(key="label.view").set_value("output").run()
    assert not at.exception, at.exception
    for name in ("enable_rectify", "enable_glare", "enable_contrast"):
        at.toggle(key=f"cfg.label.{name}").set_value(False).run()
    assert not at.exception, at.exception
    assert any("未啟用" in m.value for m in at.metric)


def test_label_page_rejects_invalid_config():
    at = _app("app_pages/label.py")
    at.number_input(key="cfg.label.canny_low").set_value(400).run()
    assert any("參數不合法" in e.value for e in at.error)


def test_food_page_crops_synthetic_dishes():
    at = _app("app_pages/food.py")
    assert any("處理完成" in m.value for m in at.markdown)
    dishes = next(m for m in at.metric if "菜數" in m.label)
    assert dishes.value == "3"  # 預設合成 3 盤
    plates = next(m for m in at.metric if "盤緣" in m.label)
    assert plates.value == "未啟用"


def test_food_page_views_switch():
    at = _app("app_pages/food.py")
    for view in ("mask", "plates", "crops", "vlm"):
        at.segmented_control(key="food.view").set_value(view).run()
        assert not at.exception, view
    assert len(at.dataframe) >= 1  # VLM 尺寸試算表


def test_food_page_plates_and_no_dish():
    at = _app("app_pages/food.py")
    at.toggle(key="cfg.food.enable_plate").set_value(True).run()
    assert not at.exception, at.exception
    plates = next(m for m in at.metric if "盤緣" in m.label)
    assert plates.value == "3"
    at.number_input(key="food.n").set_value(0).run()
    assert not at.exception, at.exception
    assert any("有警告" in m.value for m in at.markdown)


def test_food_page_rejects_invalid_config():
    at = _app("app_pages/food.py")
    at.number_input(key="cfg.food.plate_canny_low").set_value(400).run()
    assert any("參數不合法" in e.value for e in at.error)


def test_dev_checks_page_renders():
    at = _app("app_pages/dev_checks.py")
    assert len(at.button) >= 4


def test_e1_page_empty_folder(tmp_path):
    at = _app("app_pages/e1.py")
    at.text_input(key="e1.root").input(str(tmp_path)).run()
    assert not at.exception, at.exception
    assert any("尚無執行結果" in m.value for m in at.markdown)


def test_e1_page_shows_run(tmp_path):
    from dietai.evaluation import Arm, read_manifest, run_experiment
    from dietai.preprocess import LadderConfig, ZxingConfig
    from dietai.synthetic import write_barcode_dataset

    manifest = read_manifest(write_barcode_dataset(tmp_path / "data", n_codes=1))
    off = ZxingConfig(False, False, False)
    arms = [Arm("raw", zxing=off, ladder=LadderConfig(rungs=(Rung.RAW,))), Arm("full", zxing=off)]
    run_experiment(manifest, arms, tmp_path / "runs" / "r1")

    at = _app("app_pages/e1.py")
    at.text_input(key="e1.root").input(str(tmp_path / "runs")).run()
    assert not at.exception, at.exception
    assert at.metric[0].value == str(len(manifest.items))
    at.selectbox(key="e1.by").set_value("condition").run()
    assert not at.exception, at.exception
    assert len(at.dataframe) >= 2  # 整體彙整與失敗清單


def test_e1_page_follows_folder_change(tmp_path):
    """換資料夾後應改選新資料夾中最新的一次執行，不可沿用舊選取（或維持空白）。"""
    from dietai.evaluation import Arm, read_manifest, run_experiment
    from dietai.preprocess import ZxingConfig
    from dietai.synthetic import write_barcode_dataset

    manifest = read_manifest(write_barcode_dataset(tmp_path / "data", n_codes=1))
    arm = Arm("raw", zxing=ZxingConfig(False, False, False))
    for folder in ("a", "b"):
        run_experiment(manifest, [arm], tmp_path / folder / "r1")

    at = _app("app_pages/e1.py")
    at.text_input(key="e1.root").input(str(tmp_path / "a")).run()
    assert at.selectbox(key="e1.run").value == tmp_path / "a" / "r1"
    at.text_input(key="e1.root").input(str(tmp_path / "b")).run()
    assert not at.exception, at.exception
    assert at.selectbox(key="e1.run").value == tmp_path / "b" / "r1"
