#!/bin/bash

# Quick coverage statistics script
echo "📊 DevPad Test Coverage Statistics"
echo "================================="

if [ -d "coverage/api" ]; then
    echo "📁 API Package: coverage/api/"
fi

if [ -d "coverage/core" ]; then
    echo "📁 Core Package: coverage/core/"
fi

if [ -d "coverage/integration" ]; then
    echo "📁 Integration Tests: coverage/integration/"
fi

echo ""
echo "💡 To view detailed coverage, run: make coverage"