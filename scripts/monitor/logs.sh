#!/bin/bash

# devpad Log Viewer
# Usage: ./logs.sh [staging|production] [--follow] [--filter=pattern] [--lines=N]

# Default values
ENVIRONMENT=${1:-production}
FOLLOW=false
FILTER=""
LINES=100

# Parse arguments
shift # Remove first argument (environment)
while [[ $# -gt 0 ]]; do
    case $1 in
        --follow|-f)
            FOLLOW=true
            shift
            ;;
        --filter=*)
            FILTER="${1#*=}"
            shift
            ;;
        --lines=*)
            LINES="${1#*=}"
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [staging|production] [--follow] [--filter=pattern] [--lines=N]"
            exit 1
            ;;
    esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

# Determine container name
if [ "$ENVIRONMENT" = "staging" ]; then
    CONTAINER="devpad-staging"
    echo -e "${YELLOW}📋 Viewing logs for STAGING environment${NC}"
else
    CONTAINER="devpad-production"
    echo -e "${GREEN}📋 Viewing logs for PRODUCTION environment${NC}"
fi

echo -e "${CYAN}Container: $CONTAINER${NC}"
echo -e "${CYAN}Lines: $LINES${NC}"
[ -n "$FILTER" ] && echo -e "${CYAN}Filter: $FILTER${NC}"
[ "$FOLLOW" = true ] && echo -e "${CYAN}Following: Yes${NC}"
echo "----------------------------------------"

# Build docker logs command
CMD="docker logs"

if [ "$FOLLOW" = true ]; then
    CMD="$CMD -f"
fi

CMD="$CMD --tail $LINES $CONTAINER 2>&1"

# Apply filter if specified
if [ -n "$FILTER" ]; then
    CMD="$CMD | grep --color=always -E '$FILTER'"
fi

# Add color coding for different log levels
CMD="$CMD | sed -e 's/ERROR/$(printf '\033[0;31mERROR\033[0m')/g' \
               -e 's/WARN/$(printf '\033[1;33mWARN\033[0m')/g' \
               -e 's/INFO/$(printf '\033[0;32mINFO\033[0m')/g' \
               -e 's/DEBUG/$(printf '\033[0;36mDEBUG\033[0m')/g'"

# Execute command
eval $CMD

# If not following, show summary
if [ "$FOLLOW" = false ]; then
    echo ""
    echo "----------------------------------------"
    echo -e "${GREEN}✓ Log viewing complete${NC}"
    echo ""
    echo "Tips:"
    echo "  • Use --follow to stream logs in real-time"
    echo "  • Use --filter='pattern' to search for specific content"
    echo "  • Use --lines=N to show last N lines"
    echo ""
    echo "Examples:"
    echo "  $0 staging --follow"
    echo "  $0 production --filter='ERROR' --lines=500"
    echo "  $0 staging --follow --filter='api|auth'"
fi