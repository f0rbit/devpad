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