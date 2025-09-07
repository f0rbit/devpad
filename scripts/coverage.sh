#!/bin/bash

# DevPad Test Coverage Script
# Uses Bun's native coverage capabilities without external dependencies

set -e

echo "📊 Generating test coverage for devpad/api, devpad/core, devpad/server..."

# Create coverage directory
mkdir -p coverage
rm -rf coverage/*

# Build packages first to ensure imports work
echo "🔨 Building packages for coverage testing..."
cd packages/schema && bun run build > /dev/null 2>&1 || true
cd ../..

# Function to run coverage with error handling
run_coverage() {
    local package_name=$1
    local package_path=$2
    local coverage_dir=$3
    
    echo "🧪 Running unit tests with coverage for ${package_name}..."
    
    if [ -d "${package_path}" ]; then
        cd "${package_path}"
        
        # Generate coverage data
        mkdir -p "../../${coverage_dir}"
        if bun test --coverage --coverage-dir="../../${coverage_dir}" 2>/dev/null; then
            echo "  ✅ Coverage data generated"
        else
            echo "  ⚠️  Coverage generation failed"
        fi
        
        # Generate text report and capture the output
        echo "  📋 Coverage Summary:"
        if bun test --coverage --coverage-reporter=text 2>/dev/null | tail -n +2; then
            echo "  ✅ Text report generated"
        else
            echo "  ⚠️  Some tests failed"
        fi
        
        cd ../..
    else
        echo "  ❌ Package directory not found: ${package_path}"
    fi
    
    echo ""
}

# Run coverage for each package
run_coverage "@devpad/api" "packages/api" "coverage/api"
run_coverage "@devpad/core" "packages/core" "coverage/core"

# Run integration tests with coverage
echo "🧪 Running integration tests with coverage..."
mkdir -p coverage/integration
if timeout 90s bun test integration --concurrent 1 --coverage --coverage-dir=coverage/integration 2>/dev/null; then
    echo "  ✅ Integration coverage data generated"
else
    echo "  ⚠️  Integration coverage generation failed"
fi

echo "  📋 Integration Coverage Summary:"
if timeout 90s bun test integration --concurrent 1 --coverage --coverage-reporter=text 2>/dev/null | tail -n +2; then
    echo "  ✅ Integration text report generated"
else
    echo "  ⚠️  Some integration tests failed"
fi

echo ""

# Display summary
echo "📋 Coverage Summary:"
echo "  📁 API Package:        coverage/api/"
echo "  📁 Core Package:       coverage/core/" 
echo "  📁 Integration Tests:  coverage/integration/"

echo ""
echo "✅ Coverage generation complete!"
echo ""
echo "🔧 Tools used:"
echo "  • Bun native coverage (--coverage)"
echo "  • Zero external dependencies! 🎉"