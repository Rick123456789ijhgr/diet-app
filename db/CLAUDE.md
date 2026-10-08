# CLAUDE.md（db／資料庫 migration）

- 工具：golang-migrate（檔名 `NNNNNN_描述.up.sql`／`.down.sql`）。
- 已合併到 main 的 migration **不可修改**，要改就新增一支。
- 每支 up 都要有對應、可執行的 down。
- Python 唯讀帳號只能讀 `ai_*` 開頭的 view；這些 view 是 Go 與 Python 之間的資料契約，修改前須在 PR 中通知 ai 負責人。
- 本資料夾的變更必須由人主導，AI 工具不得自行新增或修改 migration。
