import streamlit as st

from wb import checks
from wb.st_layout import empty_state, page_header, section

page_header(
    "測試與檢查",
    "Checks",
    "在目前的 Python 環境執行測試與靜態檢查；修改程式後可直接在這裡驗證。",
    ":material/fact_check:",
)

st.session_state.setdefault("checks.history", [])
history: list[checks.CheckResult] = st.session_state["checks.history"]

tests_col, tools_col = st.columns([3, 2], gap="large")
command: list[str] | None = None

with tests_col, st.container(border=True, height="stretch"):
    section("單元測試", "pytest", ":material/science:")
    targets = st.pills(
        "測試範圍 · Targets",
        checks.discover_test_targets(),
        selection_mode="multi",
        key="checks.targets",
        help="不選則執行全部測試。",
    )
    with st.container(horizontal=True, vertical_alignment="bottom"):
        keyword = st.text_input(
            "關鍵字篩選 · -k", key="checks.keyword", placeholder="例如 blur and not slow"
        )
        include_slow = st.toggle("含 slow 測試", key="checks.slow")
    if st.button("執行測試 · Run tests", icon=":material/play_arrow:", type="primary"):
        command = checks.pytest_command(list(targets or []), include_slow, keyword)

with tools_col, st.container(border=True, height="stretch"):
    section("靜態檢查", "Lint & types", ":material/rule:")
    st.caption("與 CI、`make lint-ai` 相同的檢查。")
    for name in checks.TOOL_COMMANDS:
        if st.button(name, icon=":material/play_arrow:", key=f"checks.{name}", width="stretch"):
            command = checks.TOOL_COMMANDS[name]

if command is not None:
    with st.spinner("執行中… · Running"):
        history.insert(0, checks.run(command))
    del history[10:]

section("執行結果", "Results", ":material/terminal:")
if not history:
    empty_state("尚未執行。選擇上方的測試或檢查開始。", ":material/terminal:")
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
        st.code(result.output or "（無輸出）", language="text")
