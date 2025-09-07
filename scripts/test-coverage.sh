#!/bin/bash

# Test coverage focused on packages/api, packages/core, packages/server

set -e

echo "Running test coverage for packages/api, packages/core, packages/server..."

# Clean coverage directory
rm -rf coverage
mkdir -p coverage

# Build dependencies
echo "Building dependencies..."
cd packages/schema && bun run build > /dev/null 2>&1
cd ../core && bun run build > /dev/null 2>&1
cd ../..

# Run integration tests with coverage, including specific source paths
echo "Running integration tests with coverage..."
bun test integration/ --coverage \
    --coverage-reporter=lcov \
    --coverage-dir=coverage \
    --coverage-include='packages/api/src/**/*.ts' \
    --coverage-include='packages/core/src/**/*.ts' \
    --coverage-include='packages/server/src/**/*.ts' \
    --coverage-exclude='**/__tests__/**' \
    --coverage-exclude='**/tests/**' \
    --coverage-exclude='tests/**'

# Core package unit tests (if any exist)
if [ -f "packages/core/src/services/__tests__/github-fixtures.test.ts" ]; then
    echo "Running core package unit tests..."
    cd packages/core
    # Run core tests with coverage and append to main LCOV file
    bun test --coverage \
        --coverage-reporter=lcov \
        --coverage-dir=temp-coverage \
        --coverage-include='src/**/*.ts' \
        --coverage-exclude='**/__tests__/**' \
        --coverage-exclude='**/tests/**' \
        2>/dev/null || true
    if [ -f "temp-coverage/lcov.info" ]; then
        echo "Merging core package coverage..."
        # Fix paths in core LCOV to be relative to project root
        sed 's|^SF:|SF:packages/core/|' temp-coverage/lcov.info >> ../../coverage/lcov.info
    fi
    rm -rf temp-coverage
    cd ../..
fi

# API package unit tests (if any exist)
if [ -d "packages/api/tests" ]; then
    echo "Running api package unit tests..."
    cd packages/api
    # Run api tests with coverage
    bun test --coverage \
        --coverage-reporter=lcov \
        --coverage-dir=temp-coverage \
        --coverage-include='src/**/*.ts' \
        --coverage-exclude='**/__tests__/**' \
        --coverage-exclude='**/tests/**' \
        2>/dev/null || true
    if [ -f "temp-coverage/lcov.info" ]; then
        echo "Merging api package coverage..."
        # Fix paths in api LCOV to be relative to project root
        sed 's|^SF:|SF:packages/api/|' temp-coverage/lcov.info >> ../../coverage/lcov.info
    fi
    rm -rf temp-coverage
    cd ../..
fi

# Generate HTML coverage report if genhtml is available
if command -v genhtml >/dev/null 2>&1; then
    echo "Generating HTML coverage report..."
    genhtml coverage/lcov.info --output-directory coverage --quiet
    echo "HTML report generated: coverage/index.html"
else
    echo "Note: Install lcov for HTML reports: brew install lcov (macOS) or apt-get install lcov (Ubuntu)"
fi

echo "Coverage complete. LCOV report: coverage/lcov.info"
echo "Coverage focused on: packages/api/src, packages/core/src, packages/server/src"
