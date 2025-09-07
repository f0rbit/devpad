# Testing & Coverage

This document explains the testing and coverage setup for DevPad.

## Quick Start

```bash
# Run all tests with coverage
make coverage

# View coverage statistics
make coverage-stats

# Run specific test types
make unit          # Unit tests only
make integration   # Integration tests only
make test          # All tests
```

## Coverage Reports

### Command: `make coverage`
Runs `scripts/coverage.sh` which generates comprehensive test coverage for:
- **@devpad/api** - API client package
- **@devpad/core** - Core business logic 
- **@devpad/server** - Server package (via integration tests)

### Technology Stack
- **Bun Native Coverage**: Uses built-in `--coverage` support
- **Pure Bash Analysis**: Native shell scripts for coverage parsing
- **Zero External Dependencies**: No external coverage tools required

### Coverage Artifacts
- `coverage/api/` - API package coverage data
- `coverage/core/` - Core package coverage data
- `coverage/integration/` - Integration test coverage data
- `coverage/combined/` - Combined coverage statistics

## Coverage Statistics

### Current Coverage (as of latest run):
- **API Package**: ~50% line coverage
- **Core Package**: ~64% line coverage 
- **Integration Tests**: ~65% line coverage
- **Combined Total**: ~57% line coverage

### Command: `make coverage-stats`
Shows quick coverage statistics without re-running tests.

## Test Structure

```
packages/
├── api/tests/unit/          # API package unit tests
├── core/src/**/__tests__/   # Core package unit tests  
└── server/                  # No direct tests (covered via integration)

tests/
├── integration/             # Integration tests (test all packages)
├── shared/                  # Shared test utilities
└── helpers/                 # Test helper functions
```

## Coverage Requirements

- **Unit Tests**: Focus on individual functions and classes
- **Integration Tests**: Test full API workflows end-to-end
- **Coverage Goals**: 
  - API Package: >70% line coverage
  - Core Package: >80% line coverage
  - Integration: >60% line coverage

## Troubleshooting

### Missing Coverage Data
If coverage reports are empty:
1. Check that tests are passing: `make test`
2. Ensure packages are built: `bun run build`
3. Verify Bun is installed and up to date: `bun --version`

### Test Failures
Integration tests may fail if:
- Server dependencies aren't properly installed
- Database migrations haven't run
- Port 3001 is already in use
- Zod version mismatches between packages

### Build Issues
If unit tests have import errors:
1. Build schema package: `cd packages/schema && bun run build`
2. Clean and reinstall: `make clean && bun install`
3. Check for zod version consistency: `grep zod packages/*/package.json`