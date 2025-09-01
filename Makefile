build:
	docker build -t devpad-app -f deployment/Dockerfile .

run:
	docker run -p 8080:8080 -v ./database/preview.db:/sqlite.db devpad-app

unit:
	bun test unit

integration:
	bun test integration --concurrent 1

test: unit integration

clean:
	rm -rf packages/*/dist
	# clean all .js, .d.ts, .map files in packages except env.d.ts
	find packages -name "*.js" -delete 2>/dev/null || true
	find packages -name "*.d.ts" ! -name "env.d.ts" -delete 2>/dev/null || true
	find packages -name "*.map" -delete 2>/dev/null || true

build-api:
	cd packages/schema && bun run build
	cd packages/api && bun run build