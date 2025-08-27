build:
	docker build -t devpad-app -f deployment/Dockerfile .

run:
	docker run -p 8080:8080 -v ./database/preview.db:/sqlite.db devpad-app

.PHONY: test integration-test

# Run unit tests
test:
	cd app/api && bun test:unit

# Run integration tests
integration-test:
	PORT=8080 ./scripts/run-integration-tests.sh