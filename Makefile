build:
	docker build -t devpad-app -f deployment/Dockerfile .

run:
	docker run -p 8080:8080 -v ./database/preview.db:/sqlite.db devpad-app

unit:
	cd app/api && bun test:unit

integration:
	./scripts/run-integration-tests.sh

test: unit integration

clean:
	rm -rf app/api/dist
	rm -rf app/dist
	# clean all .js, .d.ts, .map files in app/src and app/api/src except env.d.ts
	find app/src app/api/src -name "*.js" -delete
	find app/src app/api/src -name "*.d.ts" ! -name "env.d.ts" -delete
	find app/src app/api/src -name "*.map" -delete

build-api:
	cd app/api && bun run build