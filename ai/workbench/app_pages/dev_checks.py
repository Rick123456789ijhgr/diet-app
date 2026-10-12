import streamlit as st

from wb import checks
from wb.st_layout import empty_state, page_header, section, workspace

page_header(
    "測試與檢查",
    "在目前的 Python 環境執行測試與靜態檢查；修改程式後可直接在這裡驗證。",
    ":material/fact_check:",
)

st.session_state.setdefault("checks.history", [])
history: list[checks.CheckResult] = st.session_state["checks.history"]
command: list[str] | None = None

panel, results = workspace()

with panel:
    st.space("small")
    section("單元測試", ":material/science:")
    targets = st.pills(
        "測試範圍",
        checks.discover_test_targets(),
        selection_mode="multi",
        key="checks.targets",
        help="不選則執行全部測試。",
    )
    keyword = st.text_input(
        "關鍵字篩選", key="checks.keyword", placeholder="例如 blur and not slow"
    )
    include_slow = st.toggle("含 slow 測試", key="checks.slow")
    if st.button("執行測試", icon=":material/play_arrow:", type="primary", width="stretch"):
        command = checks.pytest_command(list(targets or []), include_slow, keyword)

    st.space("small")
    section("靜態檢查", ":material/rule:")
    st.caption("與 CI、`make lint-ai` 相同的檢查。")
    for name in checks.TOOL_COMMANDS:
        if st.button(name, icon=":material/play_arrow:", key=f"checks.{name}", width="stretch"):
            command = checks.TOOL_COMMANDS[name]

with results:
    if command is not None:
        with st.spinner("執行中…"):
            history.insert(0, checks.run(command))
        del history[10:]

    if not history:
        empty_state("尚未執行。在左側選擇測試或檢查。", ":material/terminal:")
    for i, result in enumerate(history):
        summary = checks.pytest_summary(result.output) if "pytest" in result.command else None
        status = "通過" if result.ok else f"失敗（結束碼 {result.returncode}）"
        title = f"{' '.join(result.command[2:])}　·　{status}　·　{result.elapsed_s:.1f} 秒"
        if summary:
            title += f"　·　{summary}"
        with st.expander(
            title,
            expanded=i == 0,
            icon=":material/check_circle:" if result.ok else ":material/error:",
        ):
            st.code(result.output or "（無輸出）", language="text", height=420)
