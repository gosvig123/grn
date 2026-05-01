BINARY    := gappd
BUILD_DIR := ./build
OUTPUT    ?= $(BUILD_DIR)/$(BINARY)
MODULE    := $(shell grep '^module' go.mod 2>/dev/null | awk '{print $$2}')
VERSION   := $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS   := -s -w -X $(MODULE)/internal/version.Version=$(VERSION)
DB_PATH   := ~/.gappd/db.sqlite
SCHEMA    := ./internal/db/schema.sql
UNAME_S   := $(shell uname -s)

export MACOSX_DEPLOYMENT_TARGET ?= 13.0

.PHONY: build build-capture ensure-macos run dev db-init db-reset clean install-capture install

build:
	@mkdir -p $(dir $(OUTPUT))
	@rm -f $(OUTPUT)
	go build -ldflags "$(LDFLAGS)" -o $(OUTPUT) ./cmd/gappd

build-capture: ensure-macos
	@bash capture-helper/build.sh

ensure-macos:
	@if [ "$(UNAME_S)" != "Darwin" ]; then \
		echo "capture-helper targets are only supported on macOS"; \
		exit 1; \
	fi

install-capture: build-capture
	@echo "Installing GappdCapture.app to ~/.gappd/..."
	@mkdir -p $(HOME)/.gappd
	@rm -rf $(HOME)/.gappd/GappdCapture.app
	@cp -R $(BUILD_DIR)/GappdCapture.app $(HOME)/.gappd/GappdCapture.app
	@echo "Done. gappd-capture installed at ~/.gappd/GappdCapture.app"

install: build
	@echo "Installing gappd binary to /usr/local/bin/..."
	install -m 755 $(BUILD_DIR)/$(BINARY) /usr/local/bin/$(BINARY)
	@echo "Done. Run: gappd"

run: build
	$(BUILD_DIR)/$(BINARY)

dev:
	@which watchexec > /dev/null 2>&1 || { echo "install watchexec: cargo install watchexec-cli"; exit 1; }
	watchexec -r -e go -- go run ./cmd/gappd

db-init:
	@mkdir -p ~/.gappd
	sqlite3 $(DB_PATH) < $(SCHEMA)
	@echo "database initialised at $(DB_PATH)"

db-reset:
	rm -f $(DB_PATH)
	$(MAKE) db-init

clean:
	rm -rf $(BUILD_DIR)
	go clean -cache -testcache
