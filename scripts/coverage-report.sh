#!/bin/bash

# Display coverage summary from LCOV file with per-package breakdown

if [ ! -f "coverage/lcov.info" ]; then
    echo "No coverage data found. Run './scripts/test-coverage.sh' first."
    exit 1
fi

echo "Coverage Report for devpad"
echo "========================="

# Function to calculate coverage for a specific package
calculate_package_coverage() {
    local package_path=$1
    local package_name=$2
    
    local package_total=0
    local package_covered=0
    local in_package=false
    
    while IFS= read -r line; do
        case "$line" in
            SF:*$package_path*)
                in_package=true
                ;;
            SF:*)
                in_package=false
                ;;
            LF:*)
                if [ "$in_package" = true ]; then
                    lf=$(echo "$line" | cut -d: -f2)
                    package_total=$((package_total + lf))
                fi
                ;;
            LH:*)
                if [ "$in_package" = true ]; then
                    lh=$(echo "$line" | cut -d: -f2)
                    package_covered=$((package_covered + lh))
                fi
                ;;
        esac
    done < coverage/lcov.info
    
    if [ $package_total -gt 0 ]; then
        local percentage=$((package_covered * 100 / package_total))
        printf "  %-12s %3d/%3d (%2d%%)\n" "$package_name:" "$package_covered" "$package_total" "$percentage"
    else
        printf "  %-12s %s\n" "$package_name:" "No coverage data"
    fi
}

echo "Package Coverage:"
calculate_package_coverage "packages/api/src" "api"
calculate_package_coverage "packages/core/src" "core" 
calculate_package_coverage "packages/worker/src" "worker"

echo ""

# Overall coverage statistics
total_lines=0
covered_lines=0

while IFS= read -r line; do
    case "$line" in
        LF:*)
            lf=$(echo "$line" | cut -d: -f2)
            total_lines=$((total_lines + lf))
            ;;
        LH:*)
            lh=$(echo "$line" | cut -d: -f2)
            covered_lines=$((covered_lines + lh))
            ;;
    esac
done < coverage/lcov.info

if [ $total_lines -gt 0 ]; then
    percentage=$((covered_lines * 100 / total_lines))
    echo "Total Coverage: $covered_lines/$total_lines ($percentage%)"
else
    echo "No coverage data available"
fi

echo ""

# Check if HTML coverage report exists and provide browser URL
if [ -f "coverage/index.html" ]; then
    echo "📁 Coverage Files:"
    echo "  LCOV file: coverage/lcov.info"
    echo "  HTML report: coverage/index.html"
    echo ""
    echo "🌐 View in browser:"
    echo "  file://$(pwd)/coverage/index.html"
    echo ""
    echo "💡 To open automatically:"
    echo "  open coverage/index.html    # macOS"
    echo "  xdg-open coverage/index.html # Linux"
else
    echo "LCOV file: coverage/lcov.info"
    echo "Use with VS Code Coverage Gutters extension or upload to coverage services"
fi

echo ""
echo "Coverage focused on: packages/api/src, packages/core/src, packages/worker/src"