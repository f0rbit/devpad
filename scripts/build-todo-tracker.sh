#!/bin/bash

# Build todo-tracker binary from source
# This is needed for local development and testing

set -e

echo "🔍 Building todo-tracker binary..."

# Check if Go is installed
if ! command -v go &> /dev/null; then
    echo "❌ Go is not installed. Please install Go first."
    echo "💡 Visit: https://golang.org/dl/"
    exit 1
fi

# Create temporary directory
TEMP_DIR=$(mktemp -d)
echo "📁 Using temporary directory: $TEMP_DIR"

# Clone the repository
echo "📥 Cloning todo-tracker repository..."
git clone https://github.com/f0rbit/todo-tracker.git "$TEMP_DIR"

# Build the binary
echo "🔨 Building binary..."
cd "$TEMP_DIR"
go build -o todo-tracker

# Move to project root
echo "📋 Moving binary to project root..."
mv todo-tracker "$(dirname "$0")/../todo-tracker"

# Clean up
echo "🧹 Cleaning up..."
rm -rf "$TEMP_DIR"

echo "✅ todo-tracker binary built successfully!"
echo "💡 You can now run integration tests that require the binary."