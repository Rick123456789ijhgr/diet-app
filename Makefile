.PHONY: up down setup test lint gen test-api test-ai lint-api lint-ai workbench e1-synthetic

# Windows（PowerShell／cmd 下由 cmd.exe 執行）與 Linux／macOS（sh）共用：
# 指令只用兩邊都支援的語法，含斜線的執行檔路徑一律加引號。
ifeq ($(OS),Windows_NT)
VENV_BIN := .venv/Scripts
else
VENV_BIN := .venv/bin
endif

# ai/ 下有虛擬環境就用它（不必先 activate），否則用 PATH 上的 python（例如 CI）。
ifneq ($(wildcard ai/$(VENV_BIN)/python*),)
AI_PY := "$(VENV_BIN)/python"
else
AI_PY := python
endif

ifeq ($(OS),Windows_NT)
# cmd 沒有 test -z，改用 Python 檢查 gofmt 輸出是否為空
GOFMT_CHECK := python -c "import subprocess,sys;o=subprocess.run(['gofmt','-l','.'],capture_output=True,text=True).stdout;print(o,end='');sys.exit(bool(o.strip()))"
else
GOFMT_CHECK := test -z "$$(gofmt -l .)"
endif

up:
	docker compose -f deploy/docker-compose.yml --env-file .env up -d --build

down:
	docker compose -f deploy/docker-compose.yml --env-file .env down

# 建立 ai/.venv 並安裝開發所需套件（含工作台與 gRPC 服務）
setup:
	cd ai && python -m venv .venv
	cd ai && "$(VENV_BIN)/python" -m pip install -e ".[dev,vision,workbench,grpc]"

test: test-api test-ai

test-api:
	cd api && go test ./...

test-ai:
	cd ai && $(AI_PY) -m pytest

lint: lint-api lint-ai
	buf lint proto

lint-api:
	cd api && go vet ./... && $(GOFMT_CHECK)

lint-ai:
	cd ai && $(AI_PY) -m ruff check . ../research && $(AI_PY) -m ruff format --check . ../research && $(AI_PY) -m mypy

# 開發工作台，開啟 http://localhost:8501（未安裝請先 make setup）
workbench:
	cd ai && $(AI_PY) -m streamlit run workbench/streamlit_app.py --server.headless false

# E1 條碼消融：以合成資料端到端跑一次（產生資料 → 執行所有實驗組 → 分組彙整）
E1 := ../research/experiments/e1_barcode
e1-synthetic:
	cd ai && $(AI_PY) $(E1)/make_synthetic.py
	cd ai && $(AI_PY) $(E1)/run.py --manifest $(E1)/synthetic/manifest.csv --label synthetic
	cd ai && $(AI_PY) $(E1)/analyze.py

# 產生程式碼（產生結果提交進 git，CI 檢查與規格一致）。工具版本固定，升級時一併重新產生。
# buf 需先安裝：go install github.com/bufbuild/buf/cmd/buf@v1.73.0
OAPI_CODEGEN := github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.0
OPENAPI_TS := openapi-typescript@7.13.0
gen:
	cd proto && buf generate
	cd api && go run $(OAPI_CODEGEN) -generate types,std-http-server,strict-server -package workbenchapi -o gen/openapi/workbenchapi/workbench.gen.go ../openapi/workbench.yaml
	npx --yes $(OPENAPI_TS) openapi/workbench.yaml -o workbench/src/api/gen/workbench.ts
	@echo "TODO: 加入 sqlc、APP 的 openapi-generator 指令"
