# Persona Chatbot — common tasks.
# `make` starts the dev server; `make help` lists everything.

NPM  := npm
PORT ?= 3000

# telemetry.nextjs.org is DNS-sinkholed on some networks: it resolves, then
# drops the TCP connect. `next build` awaits two telemetry flushes, so each
# one costs a full ~21s connect timeout. Opting out keeps builds off the wire.
export NEXT_TELEMETRY_DISABLED := 1

.DEFAULT_GOAL := dev

.PHONY: help install dev build start lint typecheck check clean distclean db-up db-setup ingest test

help: ## List available targets
	@awk 'BEGIN{FS=":.*?## "} /^[a-zA-Z_-]+:.*?## /{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo
	@echo "  Override the port with: make dev PORT=4000"

# Reinstall only when the manifests are newer than the installed tree.
node_modules: package.json package-lock.json
	$(NPM) install
	@touch node_modules

install: node_modules ## Install dependencies

dev: node_modules ## Run the dev server (default)
	$(NPM) run dev -- --port $(PORT)

build: node_modules ## Production build
	$(NPM) run build

run: build ## Serve the production build
	$(NPM) run start -- --port $(PORT)

lint: node_modules ## Run ESLint
	$(NPM) run lint

typecheck: node_modules ## Generate route types, then typecheck
	npx next typegen
	npx tsc --noEmit

check: lint typecheck build ## Everything CI would run

db-up: ## Start Postgres + pgvector in Docker
	docker-compose up -d --wait

db-setup: node_modules ## Apply db/schema.sql (idempotent)
	$(NPM) run db:setup

ingest: node_modules ## Embed the curated personas (skips unchanged ones)
	$(NPM) run ingest

test: node_modules ## Run the test suite (needs `make db-up`)
	$(NPM) test

clean: ## Remove build output
	rm -rf .next out

distclean: clean ## Also remove installed dependencies
	rm -rf node_modules
