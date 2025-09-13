#!/bin/bash
# Script to properly stop and clean up Docker containers on the VPS

echo "🔍 Checking running containers..."
sudo docker ps

echo -e "\n📦 Stopping devpad containers..."
# Stop all devpad containers regardless of how they were started
sudo docker stop devpad-production devpad-staging 2>/dev/null || true

echo -e "\n🗑️  Removing stopped containers..."
sudo docker rm devpad-production devpad-staging 2>/dev/null || true

echo -e "\n🔍 Checking if network is still in use..."
NETWORK_CONTAINERS=$(sudo docker network inspect devpad_default -f '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null)

if [ -n "$NETWORK_CONTAINERS" ]; then
    echo "⚠️  Network still used by: $NETWORK_CONTAINERS"
    echo "Stopping those containers..."
    for container in $NETWORK_CONTAINERS; do
        sudo docker stop $container 2>/dev/null || true
    done
fi

echo -e "\n🧹 Cleaning up network..."
sudo docker network rm devpad_default 2>/dev/null || true

echo -e "\n✅ Cleanup complete!"
echo -e "\n📋 Current status:"
sudo docker ps