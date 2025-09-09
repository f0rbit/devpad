#!/bin/bash

# devpad Metrics Dashboard
# Usage: ./metrics.sh [staging|production|all]

ENVIRONMENT=${1:-all}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'

# Header
clear
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║              devpad Metrics Dashboard                     ║${NC}"
echo -e "${CYAN}║                  $(date '+%Y-%m-%d %H:%M:%S')                        ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Function to get container metrics
get_container_metrics() {
    local container=$1
    local env_name=$2
    
    if docker ps --format "{{.Names}}" | grep -q "^$container$"; then
        echo -e "${GREEN}▶ $env_name Environment${NC}"
        echo "  ├─ Status: Running ✓"
        
        # Get container stats
        STATS=$(docker stats --no-stream --format "json" $container 2>/dev/null)
        
        if [ -n "$STATS" ]; then
            CPU=$(echo $STATS | jq -r '.CPUPerc' | sed 's/%//')
            MEM=$(echo $STATS | jq -r '.MemUsage' | cut -d'/' -f1)
            MEM_LIMIT=$(echo $STATS | jq -r '.MemUsage' | cut -d'/' -f2)
            MEM_PERC=$(echo $STATS | jq -r '.MemPerc' | sed 's/%//')
            NET_IO=$(echo $STATS | jq -r '.NetIO')
            BLOCK_IO=$(echo $STATS | jq -r '.BlockIO')
            
            echo "  ├─ CPU Usage: ${CPU}%"
            echo "  ├─ Memory: ${MEM} / ${MEM_LIMIT} (${MEM_PERC}%)"
            echo "  ├─ Network I/O: ${NET_IO}"
            echo "  ├─ Disk I/O: ${BLOCK_IO}"
            
            # Health check
            HEALTH=$(docker inspect $container --format='{{.State.Health.Status}}' 2>/dev/null || echo "none")
            if [ "$HEALTH" = "healthy" ]; then
                echo -e "  ├─ Health: ${GREEN}Healthy${NC} ✓"
            elif [ "$HEALTH" = "unhealthy" ]; then
                echo -e "  ├─ Health: ${RED}Unhealthy${NC} ✗"
            else
                echo -e "  ├─ Health: ${YELLOW}No health check${NC}"
            fi
            
            # Uptime
            STARTED=$(docker inspect $container --format='{{.State.StartedAt}}' 2>/dev/null)
            if [ -n "$STARTED" ]; then
                UPTIME=$(docker ps --filter "name=$container" --format "{{.Status}}" | sed 's/Up //')
                echo "  ├─ Uptime: $UPTIME"
            fi
            
            # Port mapping
            PORTS=$(docker port $container 2>/dev/null | head -1)
            [ -n "$PORTS" ] && echo "  └─ Ports: $PORTS"
        fi
    else
        echo -e "${RED}▶ $env_name Environment${NC}"
        echo -e "  └─ Status: ${RED}Not Running${NC} ✗"
    fi
    echo ""
}

# Function to get database metrics
get_db_metrics() {
    local db_path=$1
    local env_name=$2
    
    echo -e "${BLUE}▶ $env_name Database${NC}"
    
    if [ -f "$db_path" ]; then
        SIZE=$(du -h "$db_path" 2>/dev/null | cut -f1)
        echo "  ├─ Size: $SIZE"
        
        # Get table count (if sqlite3 is available)
        if command -v sqlite3 &> /dev/null; then
            TABLES=$(sqlite3 "$db_path" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>/dev/null || echo "N/A")
            echo "  ├─ Tables: $TABLES"
            
            # Get record counts for main tables
            for table in projects tasks users; do
                COUNT=$(sqlite3 "$db_path" "SELECT COUNT(*) FROM $table;" 2>/dev/null || echo "0")
                echo "  ├─ ${table^}: $COUNT records"
            done
        fi
        
        # Last modified
        MODIFIED=$(stat -c %y "$db_path" 2>/dev/null | cut -d'.' -f1)
        echo "  └─ Last Modified: $MODIFIED"
    else
        echo -e "  └─ Status: ${YELLOW}Database not found${NC}"
    fi
    echo ""
}

# System metrics
echo -e "${MAGENTA}═══ System Metrics ═══${NC}"
echo ""

# CPU info
CPU_COUNT=$(nproc)
CPU_LOAD=$(uptime | awk -F'load average:' '{print $2}')
echo "▶ CPU"
echo "  ├─ Cores: $CPU_COUNT"
echo "  └─ Load Average:$CPU_LOAD"
echo ""

# Memory info
MEM_TOTAL=$(free -h | awk '/^Mem:/ {print $2}')
MEM_USED=$(free -h | awk '/^Mem:/ {print $3}')
MEM_FREE=$(free -h | awk '/^Mem:/ {print $4}')
MEM_PERCENT=$(free | awk '/^Mem:/ {printf "%.1f", $3/$2 * 100}')

echo "▶ Memory"
echo "  ├─ Total: $MEM_TOTAL"
echo "  ├─ Used: $MEM_USED ($MEM_PERCENT%)"
echo "  └─ Free: $MEM_FREE"
echo ""

# Disk info
DISK_USAGE=$(df -h / | awk 'NR==2 {print $3 " / " $2 " (" $5 ")"}')
echo "▶ Disk (Root)"
echo "  └─ Usage: $DISK_USAGE"
echo ""

# Container metrics
echo -e "${MAGENTA}═══ Container Metrics ═══${NC}"
echo ""

if [ "$ENVIRONMENT" = "all" ] || [ "$ENVIRONMENT" = "production" ]; then
    get_container_metrics "devpad-production" "Production"
fi

if [ "$ENVIRONMENT" = "all" ] || [ "$ENVIRONMENT" = "staging" ]; then
    get_container_metrics "devpad-staging" "Staging"
fi

# Database metrics
echo -e "${MAGENTA}═══ Database Metrics ═══${NC}"
echo ""

if [ "$ENVIRONMENT" = "all" ] || [ "$ENVIRONMENT" = "production" ]; then
    get_db_metrics "/var/data/devpad-production/devpad.db" "Production"
fi

if [ "$ENVIRONMENT" = "all" ] || [ "$ENVIRONMENT" = "staging" ]; then
    get_db_metrics "/var/data/devpad-staging/devpad-staging.db" "Staging"
fi

# Docker overview
echo -e "${MAGENTA}═══ Docker Overview ═══${NC}"
echo ""

CONTAINERS_RUNNING=$(docker ps -q | wc -l)
CONTAINERS_TOTAL=$(docker ps -aq | wc -l)
IMAGES=$(docker images -q | wc -l)
VOLUMES=$(docker volume ls -q | wc -l)

echo "▶ Docker Resources"
echo "  ├─ Containers: $CONTAINERS_RUNNING running / $CONTAINERS_TOTAL total"
echo "  ├─ Images: $IMAGES"
echo "  └─ Volumes: $VOLUMES"
echo ""

# Network info
echo -e "${MAGENTA}═══ Network Status ═══${NC}"
echo ""

# Check if services are accessible
check_endpoint() {
    local url=$1
    local name=$2
    
    if curl -s -o /dev/null -w "%{http_code}" "$url" | grep -q "200\|301\|302"; then
        echo -e "  ├─ $name: ${GREEN}Accessible${NC} ✓"
    else
        echo -e "  ├─ $name: ${RED}Not Accessible${NC} ✗"
    fi
}

echo "▶ Service Endpoints"
check_endpoint "http://localhost:3000/health" "Production (Local)"
check_endpoint "http://localhost:3001/health" "Staging (Local)"
check_endpoint "https://devpad.tools/health" "Production (Public)"
check_endpoint "https://staging.devpad.tools/health" "Staging (Public)"
echo ""

# Footer
echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
echo -e "${WHITE}Refresh: ./metrics.sh [staging|production|all]${NC}"
echo -e "${WHITE}Logs: ./logs.sh [staging|production] [--follow]${NC}"
echo -e "${WHITE}Health: ./health.sh [staging|production]${NC}"