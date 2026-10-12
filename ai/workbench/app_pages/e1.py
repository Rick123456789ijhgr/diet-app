from pathlib import Path
from typing import Any

import altair as alt
import pandas as pd
import streamlit as st

from dietai.evaluation import (
    Outcome,
    list_runs,
    load_arms,
    new_run_dir,
    read_manifest,
    read_run,
    rescue_counts,
    run_experiment,
    summarize,
)
from dietai.preprocess import Rung
from dietai.synthetic import write_barcode_dataset
from wb.images import SplitLockedError, load_image
from wb.st_layout import empty_state, page_header, section
from wb.text import OUTCOME_TEXT, outcome_label, zh_en

E1_DIR = Path(__file__).resolve().parents[3] / "research" / "experiments" / "e1_barcode"
FAILURES = (Outcome.MISREAD, Outcome.MISSED, Outcome.FALSE_POSITIVE, Outcome.ERROR)

page_header(
    "E1 條碼消融",
    "E1 barcode ablation",
    "檢視 research/experiments/e1_barcode 的執行結果：各實驗組的成功率與信賴區間、"
    "依拍攝條件分組、成功於哪一階，以及失敗影像。也可以用合成資料快速跑一次。",
    ":material/science:",
)


@st.cache_data(max_entries=8, show_spinner=False)
def _load(run_dir: str, mtime: float) -> tuple[dict[str, Any], list[dict[str, str]]]:
    return read_run(run_dir)


@st.cache_data(max_entries=8, show_spinner=False)
def _attempts(run_dir: str, mtime: float) -> pd.DataFrame:
    return pd.read_csv(Path(run_dir) / "attempts.csv", dtype=str, keep_default_na=False)


controls, results = st.columns([2, 5], gap="large")

with controls:
    with st.container(border=True):
        section("執行結果", "Runs", ":material/folder_open:")
        root = Path(st.text_input("結果資料夾 · Runs folder", str(E1_DIR / "runs"), key="e1.root"))
        runs = list_runs(root)
        # 換了資料夾（或原本沒有結果）時，選取值不在新清單中：改選最新的一次
        if st.session_state.get("e1.run") not in runs:
            st.session_state["e1.run"] = runs[0] if runs else None
        run_dir = st.selectbox(
            "執行 · Run",
            runs,
            format_func=lambda p: p.name,
            key="e1.run",
            placeholder="尚無執行結果",
        )
    with st.container(border=True):
        section("快速執行", "Quick run", ":material/play_circle:")
        st.caption(
            "以合成條碼產生資料（寫到 e1_barcode/synthetic/）並執行選取的實驗組，"
            "結果存到上方資料夾。合成資料只供驗證流程與觀察趨勢，不可作為結論。"
        )
        try:
            arms = load_arms(E1_DIR / "configs")
        except (OSError, ValueError) as exc:
            st.error(f"讀不到實驗組設定：{exc}")
            arms = []
        picked = st.multiselect(
            "實驗組 · Arms",
            [a.name for a in arms],
            default=[a.name for a in arms if a.name in ("a0_raw", "a6_full")],
            key="e1.arms",
        )
        n_codes = st.number_input("條碼數 · Codes", 1, 20, 2, key="e1.codes")
        if st.button("執行 · Run", icon=":material/play_arrow:", disabled=not picked, key="e1.go"):
            chosen = [a for a in arms if a.name in picked]
            with st.spinner("產生合成資料並執行中…"):
                manifest = write_barcode_dataset(E1_DIR / "synthetic", int(n_codes))
                out = new_run_dir(root, "workbench")
                run_experiment(read_manifest(manifest), chosen, out, label="workbench")
            st.session_state["e1.run"] = out
            st.rerun()

with results:
    if run_dir is None:
        empty_state(
            "尚無執行結果：在左側快速執行，或在終端機執行 `make e1-synthetic`。",
            ":material/science:",
        )
        st.stop()

    mtime = (run_dir / "results.csv").stat().st_mtime
    meta, rows = _load(str(run_dir), mtime)
    tags: list[str] = meta["manifest"]["tag_columns"]
    arm_names = [a["name"] for a in meta["arms"]]
    git = meta.get("git") or {}

    c1, c2, c3, c4 = st.columns(4, gap="small")
    c1.metric("影像 · Images", meta["manifest"]["items"], border=True)
    c2.metric("實驗組 · Arms", len(arm_names), border=True)
    c3.metric("耗時 · Duration", f"{meta['duration_s']:.1f} s", border=True)
    c4.metric(
        "commit",
        str(git.get("commit", "?"))[:8],
        delta="有未提交變更" if git.get("dirty") else "乾淨",
        delta_color="off",
        border=True,
        help="執行時的 git commit；有未提交變更表示結果可能無法由該 commit 重現。",
    )
    if meta["manifest"].get("include_test"):
        st.warning("此執行納入測試集（正式實驗），失敗影像不提供檢視。", icon=":material/lock:")

    with st.container(horizontal=True):
        baseline = st.selectbox("基準 · Baseline", arm_names, key="e1.baseline")
        group = st.selectbox(
            "分組 · Group by", ["", *tags], format_func=lambda t: t or "（不分組）", key="e1.by"
        )

    overall = pd.DataFrame(summarize(rows, (), baseline))
    with st.container(border=True):
        section("整體成功率", "Overall success rate", ":material/bar_chart:")
        y = alt.Y("arm:N", title=None, sort=arm_names)
        bars = (
            alt.Chart(overall)
            .mark_bar(cornerRadiusEnd=4, height={"band": 0.6})
            .encode(
                x=alt.X(
                    "rate:Q",
                    title="成功率 · Success rate（誤差線為 Wilson 95% CI）",
                    axis=alt.Axis(format="%"),
                    scale=alt.Scale(domain=[0, 1]),
                ),
                y=y,
                tooltip=[
                    alt.Tooltip("arm:N", title="實驗組"),
                    alt.Tooltip("rate:Q", title="成功率", format=".1%"),
                    alt.Tooltip("ci_low:Q", title="CI 下限", format=".1%"),
                    alt.Tooltip("ci_high:Q", title="CI 上限", format=".1%"),
                    alt.Tooltip("correct:Q", title="正確"),
                    alt.Tooltip("n:Q", title="正樣本"),
                    alt.Tooltip("p_value:Q", title="McNemar p", format=".3g"),
                ],
            )
        )
        ci = alt.Chart(overall).mark_rule(strokeWidth=2).encode(x="ci_low:Q", x2="ci_high:Q", y=y)
        st.altair_chart(
            bars + ci,
            alt="各實驗組的整體成功率長條圖，附 95% 信賴區間",
            height=max(160, 32 * len(arm_names)),
        )
        st.dataframe(
            overall,
            hide_index=True,
            alt="各實驗組的整體彙整",
            column_config={
                "rate": st.column_config.NumberColumn("成功率", format="percent"),
                "ci_low": st.column_config.NumberColumn("CI 下限", format="percent"),
                "ci_high": st.column_config.NumberColumn("CI 上限", format="percent"),
                "median_ms": st.column_config.NumberColumn("耗時中位數 ms", format="%.1f"),
                "mean_attempts": st.column_config.NumberColumn("平均嘗試", format="%.2f"),
                "p_value": st.column_config.NumberColumn("McNemar p", format="%.3g"),
            },
        )
        misreads = int(overall["misread"].sum())
        if misreads:
            st.warning(
                f"共有 {misreads} 次誤讀（檢查碼正確但內容錯誤）：會被當成另一個商品，"
                "比漏讀更危險。請在下方「失敗影像」檢視。",
                icon=":material/report:",
            )

    if group:
        by_group = pd.DataFrame(summarize(rows, (group,), baseline))
        by_group = by_group[by_group["n"] > 0]
        order = list(dict.fromkeys(by_group[group]))
        with st.container(border=True):
            section(f"依 {group} 分組", "By condition", ":material/grid_on:")
            base = alt.Chart(by_group).encode(
                x=alt.X(f"{group}:N", title=group, sort=order),
                y=alt.Y("arm:N", title=None, sort=arm_names),
            )
            cells = base.mark_rect(stroke="white", strokeWidth=2).encode(
                color=alt.Color(
                    "rate:Q",
                    title="成功率",
                    scale=alt.Scale(scheme="blues", domain=[0, 1]),
                    legend=alt.Legend(format="%"),
                ),
                tooltip=[
                    alt.Tooltip("arm:N", title="實驗組"),
                    alt.Tooltip(f"{group}:N"),
                    alt.Tooltip("rate:Q", title="成功率", format=".0%"),
                    alt.Tooltip("correct:Q", title="正確"),
                    alt.Tooltip("n:Q", title="正樣本"),
                    alt.Tooltip("misread:Q", title="誤讀"),
                ],
            )
            labels = base.mark_text(fontSize=11).encode(
                text=alt.Text("rate:Q", format=".0%"),
                color=alt.condition("datum.rate > 0.6", alt.value("white"), alt.value("black")),
            )
            st.altair_chart(
                cells + labels,
                alt=f"實驗組與 {group} 的成功率熱度圖",
                height=max(160, 32 * len(arm_names)),
            )

    rescues = rescue_counts(rows)
    if rescues:
        with st.container(border=True):
            section("成功於哪一階", "Successful rung", ":material/stairs:")
            st.caption("各階由原圖獨立產生，因此成功階就是救回該影像的步驟。")
            stacked = (
                alt.Chart(pd.DataFrame(rescues))
                .mark_bar(stroke="white", strokeWidth=2)
                .encode(
                    x=alt.X("count:Q", title="正確的影像數 · Correct images"),
                    y=alt.Y("arm:N", title=None, sort=arm_names),
                    color=alt.Color("rung:N", title="階", sort=[r.value for r in Rung]),
                    order=alt.Order("rung_order:Q"),
                    tooltip=["arm", "rung", "count"],
                )
                .transform_calculate(rung_order=f"indexof({[r.value for r in Rung]}, datum.rung)")
            )
            st.altair_chart(
                stacked, alt="各實驗組成功於各階的影像數", height=max(160, 32 * len(arm_names))
            )

    with st.container(border=True):
        section("失敗影像", "Failures", ":material/broken_image:")
        with st.container(horizontal=True):
            fail_arm = st.selectbox(
                "實驗組 · Arm", arm_names, index=len(arm_names) - 1, key="e1.fa"
            )
            kinds = st.pills(
                "結果 · Outcome",
                [o.value for o in FAILURES],
                default=[o.value for o in FAILURES],
                selection_mode="multi",
                format_func=outcome_label,
                key="e1.kinds",
            )
        failed = [r for r in rows if r["arm"] == fail_arm and r["outcome"] in (kinds or [])]
        if not failed:
            empty_state("這個實驗組沒有符合條件的失敗影像。", ":material/check_circle:")
            st.stop()
        cols = ["id", "outcome", "truth", "decoded", "success_rung", *tags, "error"]
        table = pd.DataFrame(failed)[cols]
        table["outcome"] = table["outcome"].map(outcome_label)
        event = st.dataframe(
            table,
            hide_index=True,
            on_select="rerun",
            selection_mode="single-row",
            key="e1.failtable",
            alt="失敗影像清單",
        )
        picked_rows = event.selection.rows if event else []
        if not picked_rows:
            st.caption("點選表格列以檢視影像與每一階的嘗試。")
            st.stop()
        row = failed[picked_rows[0]]
        zh, en, color = OUTCOME_TEXT[Outcome(row["outcome"])]
        st.badge(zh_en(zh, en), color=color)  # type: ignore[arg-type]
        left, right = st.columns([3, 2], gap="medium")
        with left:
            if meta["manifest"].get("include_test"):
                empty_state("測試集已鎖定，不提供影像檢視。", ":material/lock:")
            else:
                try:
                    st.image(
                        load_image(row["image"]),
                        channels="BGR",
                        caption=row["id"],
                        alt=f"失敗影像 {row['id']}",
                    )
                except (SplitLockedError, OSError, ValueError) as exc:
                    st.error(str(exc))
        with right:
            att = _attempts(str(run_dir), mtime)
            att = att[(att["id"] == row["id"]) & (att["arm"] == fail_arm)]
            st.dataframe(
                att.drop(columns=["id", "arm"]),
                hide_index=True,
                alt="這張影像每一階的嘗試紀錄",
            )
