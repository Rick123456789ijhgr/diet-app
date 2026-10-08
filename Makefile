.PHONY: up down test lint gen test-api test-ai lint-api lint-ai

up:
	docker compose -f deploy/docker-compose.yml --env-file .env up -d --build

down:
	docker compose -f deploy/docker-compose.yml --env-file .env down

test: test-api test-ai

test-api:
	cd api && go test ./...

test-ai:
	cd ai && pytest

lint: lint-api lint-ai
	buf lint proto

lint-api:
	cd api && go vet ./... && test -z "$$(gofmt -l .)"

lint-ai:
	cd ai && ruff check . && ruff format --check .

gen:
	cd proto && buf generate
	@echo "TODO: 加入 oapi-codegen、sqlc、openapi-generator 指令"
