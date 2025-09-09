#!/bin/bash

# devpad Health Check
# Usage: ./health.sh [staging|production|all]

ENVIRONMENT=${1:-all}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}═══════════════════════════════════════${NC}"
echo -e "${CYAN}    devpad Health Check Report         ${NC}"
echo -e "${CYAN}═══════════════════════════════════════${NC}"
echo ""

# Function to check health
check_health() {
    local env=$1
    local port=$2
    local url=$3
    
    echo -e "${CYAN}▶ $env Environment${NC}"
    
    # Check if container is running
    CONTAINER="devpad-${env,,}"
    if docker ps --format "{{.Names}}" | grep -q "^$CONTAINER$"; then
        echo -e "  ├─ Container: ${GREEN}Running${NC} ✓"
        
        # Check local health endpoint
        if curl -s -f "http://localhost:$port/health" > /dev/null 2>&1; then
            echo -e "  ├─ Local Health: ${GREEN}OK${NC} ✓"
            
            # Get response time
            RESPONSE_TIME=$(curl -o /dev/null -s -w '%{time_total}' "http://localhost:$port/health")
            echo "  ├─ Response Time: ${RESPONSE_TIME}s"
        else
            echo -e "  ├─ Local Health: ${RED}Failed${NC} ✗"
        fi
        
        # Check public endpoint
        if curl -s -f "$url/health" > /dev/null 2>&1; then
            echo -e "  ├─ Public Health: ${GREEN}OK${NC} ✓"
        else
            echo -e "  ├─ Public Health: ${RED}Failed${NC} ✗"
        fi
        
        # Get version info
        VERSION=$(docker inspect $CONTAINER --format='{{.Config.Env}}' | grep -oP 'VERSION=\K[^ ]+' | tr -d ']')
        [ -n "$VERSION" ] && echo "  ├─ Version: $VERSION"
        
        # Check database
        if [ "$env" = "Production" ]; then
            DB_FILE="/var/data/devpad-production/devpad.db"
        else
            DB_FILE="/var/data/devpad-staging/devpad-staging.db"
        fi
        
        if [ -f "$DB_FILE" ]; then
            echo -e "  ├─ Database: ${GREEN}Exists${NC} ✓"
            DB_SIZE=$(du -h "$DB_FILE" | cut -f1)
            echo "  ├─ DB Size: $DB_SIZE"
        else
            echo -e "  ├─ Database: ${YELLOW}Not Found${NC} ⚠"
        fi
        
        # Check recent logs for errors
        ERROR_COUNT=$(docker logs $CONTAINER --since 1h 2>&1 | grep -c "ERROR" || echo "0")
        WARN_COUNT=$(docker logs $CONTAINER --since 1h 2>&1 | grep -c "WARN" || echo "0")
        
        if [ "$ERROR_COUNT" -gt 0 ]; then
            echo -e "  ├─ Recent Errors: ${RED}$ERROR_COUNT errors in last hour${NC} ⚠"
        else
            echo -e "  ├─ Recent Errors: ${GREEN}None${NC} ✓"
        fi
        
        if [ "$WARN_COUNT" -gt 0 ]; then
            echo -e "  └─ Recent Warnings: ${YELLOW}$WARN_COUNT warnings in last hour${NC}"
        else
            echo -e "  └─ Recent Warnings: ${GREEN}None${NC} ✓"
        fi
        
    else
        echo -e "  └─ Container: ${RED}Not Running${NC} ✗"
    fi
    
    echo ""
}

# Check environments based on parameter
if [ "$ENVIRONMENT" = "all" ] || [ "$ENVIRONMENT" = "production" ]; then
    check_health "Production" "3000" "https://devpad.tools"
fi

if [ "$ENVIRONMENT" = "all" ] || [ "$ENVIRONMENT" = "staging" ]; then
    check_health "Staging" "3001" "https://staging.devpad.tools"
fi

# Overall system health
echo -e "${CYAN}▶ System Health${NC}"

# Check disk space
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -lt 80 ]; then
    echo -e "  ├─ Disk Usage: ${GREEN}${DISK_USAGE}%${NC} ✓"
elif [ "$DISK_USAGE" -lt 90 ]; then
    echo -e "  ├─ Disk Usage: ${YELLOW}${DISK_USAGE}%${NC} ⚠"
else
    echo -e "  ├─ Disk Usage: ${RED}${DISK_USAGE}%${NC} ✗"
fi

# Check memory
MEM_PERCENT=$(free | awk '/^Mem:/ {printf "%.0f", $3/$2 * 100}')
if [ "$MEM_PERCENT" -lt 80 ]; then
    echo -e "  ├─ Memory Usage: ${GREEN}${MEM_PERCENT}%${NC} ✓"
elif [ "$MEM_PERCENT" -lt 90 ]; then
    echo -e "  ├─ Memory Usage: ${YELLOW}${MEM_PERCENT}%${NC} ⚠"
else
    echo -e "  ├─ Memory Usage: ${RED}${MEM_PERCENT}%${NC} ✗"
fi

# Check load average
LOAD_1=$(uptime | awk -F'load average:' '{print $2}' | awk '{print $1}' | sed 's/,//')
CPU_COUNT=$(nproc)
LOAD_RATIO=$(echo "scale=2; $LOAD_1 / $CPU_COUNT" | bc)

if (( $(echo "$LOAD_RATIO < 0.7" | bc -l) )); then
    echo -e "  └─ Load Average: ${GREEN}$LOAD_1 ($(echo "scale=0; $LOAD_RATIO * 100" | bc)% capacity)${NC} ✓"
elif (( $(echo "$LOAD_RATIO < 0.9" | bc -l) )); then
    echo -e "  └─ Load Average: ${YELLOW}$LOAD_1 ($(echo "scale=0; $LOAD_RATIO * 100" | bc)% capacity)${NC} ⚠"
else
    echo -e "  └─ Load Average: ${RED}$LOAD_1 ($(echo "scale=0; $LOAD_RATIO * 100" | bc)% capacity)${NC} ✗"
fi

echo ""
echo -e "${CYAN}═══════════════════════════════════════${NC}"

# Summary
PROD_RUNNING=$(docker ps --format "{{.Names}}" | grep -q "^devpad-production$" && echo "true" || echo "false")
STAGING_RUNNING=$(docker ps --format "{{.Names}}" | grep -q "^devpad-staging$" && echo "true" || echo "false")

if [ "$PROD_RUNNING" = "true" ] && [ "$STAGING_RUNNING" = "true" ]; then
    echo -e "${GREEN}✓ All systems operational${NC}"
elif [ "$PROD_RUNNING" = "true" ] || [ "$STAGING_RUNNING" = "true" ]; then
    echo -e "${YELLOW}⚠ Partial system availability${NC}"
else
    echo -e "${RED}✗ Critical: No environments running${NC}"
fi

echo ""
echo "Run with: ./health.sh [staging|production|all]"