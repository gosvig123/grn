BINARY    := grn
BUILD_DIR := ./build
MODULE    := $(shell grep '^module' go.mod 2>/dev/null | awk '{print $$2}')
VERSION   := $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS   := -s -w -X $(MODULE)/internal/version.Version=$(VERSION)
DB_PATH   := ~/.grn/db.sqlite
SCHEMA    := ./internal/storage/schema.sql

.PHONY: build run dev db-init db-reset clean

build:
	@mkdir -p $(BUILD_DIR)
	go build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY) ./cmd/grn

run: build
	$(BUILD_DIR)/$(BINARY)

dev:
	@which watchexec > /dev/null 2>&1 || { echo "install watchexec: cargo install watchexec-cli"; exit 1; }
	watchexec -r -e go -- go run ./cmd/grn

db-init:
	@mkdir -p ~/.grn
	sqlite3 $(DB_PATH) < $(SCHEMA)
	@echo "database initialised at $(DB_PATH)"

db-reset:
	rm -f $(DB_PATH)
	$(MAKE) db-init

clean:
	rm -rf $(BUILD_DIR)
	go clean -cache -testcache
