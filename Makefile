build:
	docker build -t devpad-app -f deployment/Dockerfile .

run:
	docker run -p 8080:8080 -v ./database/preview.db:/sqlite.db devpad-app

unit:
	bun test unit

integration:
	bun test integration --concurrent 1

test: unit integration

coverage:
	@./scripts/coverage.sh

coverage-stats:
	@if [ ! -d coverage ]; then echo "❌ No coverage data found. Run 'make coverage' first."; exit 1; fi
	@./scripts/coverage-stats.sh

help:
	@echo "📦 DevPad Build & Test Commands"
	@echo "==============================="
	@echo "🔨 Build Commands:"
	@echo "  make build         - Build Docker image"
	@echo "  make build-api     - Build API package"
	@echo ""
	@echo "🧪 Test Commands:"
	@echo "  make unit          - Run unit tests"
	@echo "  make integration   - Run integration tests"
	@echo "  make test          - Run all tests"
	@echo ""
	@echo "📊 Coverage Commands:"
	@echo "  make coverage      - Generate test coverage using scripts/coverage.sh"
	@echo "  make coverage-stats - Show coverage statistics"
	@echo ""
	@echo "🧹 Utility Commands:"
	@echo "  make clean         - Clean build artifacts"
	@echo "  make run           - Run Docker container"

clean:
	rm -rf packages/*/dist coverage/
	# clean all .js, .d.ts, .map files in packages except env.d.ts
	find packages -name "*.js" -delete 2>/dev/null || true
	find packages -name "*.d.ts" ! -name "env.d.ts" -delete 2>/dev/null || true
	find packages -name "*.map" -delete 2>/dev/null || true

build-api:
	cd packages/schema && bun run build
	cd packages/api && bun run build