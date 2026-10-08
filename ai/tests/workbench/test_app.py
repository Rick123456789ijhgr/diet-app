"""工作台介面的冒煙測試：以 AppTest 在程序內執行，不啟動瀏覽器或伺服器。"""

from pathlib import Path

import pytest

pytest.importorskip("streamlit")

from streamlit.testing.v1 import AppTest  # noqa: E402

from dietai.synthetic import label_scene  # noqa: E402
from wb.images import encode_png  # noqa: E402

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
        "app_pages/sweep.py",
        "app_pages/batch.py",
        "app_pages/dev_checks.py",
    ],
)
def test_every_page_renders(page):
    _app(page)


def test_home_lists_thresholds():
    at = _app()
    assert len(at.dataframe) == 1
    assert len(at.button) >= 4  # 快速開始卡片


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


def test_dev_checks_page_renders():
    at = _app("app_pages/dev_checks.py")
    assert len(at.button) >= 4
