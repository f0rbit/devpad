#!/bin/bash

# VPS Setup Script for devpad
# This script sets up a fresh VPS with all required dependencies
# Usage: ./setup.sh

set -e

echo "🚀 Starting devpad VPS Setup"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root${NC}" 
   exit 1
fi

echo -e "${GREEN}✓ Running as root${NC}"

# Update system
echo "📦 Updating system packages..."
apt-get update
apt-get upgrade -y

# Install essential packages
echo "🔧 Installing essential packages..."
apt-get install -y \
    curl \
    wget \
    git \
    vim \
    htop \
    ufw \
    nginx \
    certbot \
    python3-certbot-nginx \
    jq

# Install Docker
echo "🐳 Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    echo -e "${GREEN}✓ Docker installed${NC}"
else
    echo -e "${YELLOW}Docker already installed${NC}"
fi

# Install Docker Compose
echo "🐳 Installing Docker Compose..."
if ! command -v docker-compose &> /dev/null; then
    curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    echo -e "${GREEN}✓ Docker Compose installed${NC}"
else
    echo -e "${YELLOW}Docker Compose already installed${NC}"
fi

# Create deployment directories
echo "📁 Creating directory structure..."
mkdir -p /var/deploy/devpad
mkdir -p /var/deploy/devpad-staging
mkdir -p /var/data/devpad-production
mkdir -p /var/data/devpad-staging
mkdir -p /var/log/devpad/production
mkdir -p /var/log/devpad/staging
mkdir -p /var/backups/devpad

echo -e "${GREEN}✓ Directories created${NC}"

# Set up log rotation
echo "📝 Setting up log rotation..."
cat > /etc/logrotate.d/devpad << EOF
/var/log/devpad/*/*.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    create 0644 root root
    sharedscripts
    postrotate
        docker kill -s USR1 devpad-production 2>/dev/null || true
        docker kill -s USR1 devpad-staging 2>/dev/null || true
    endscript
}
EOF

echo -e "${GREEN}✓ Log rotation configured${NC}"

# Configure firewall
echo "🔒 Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow http
ufw allow https
ufw allow 3000/tcp  # Production
ufw allow 3001/tcp  # Staging
ufw --force enable

echo -e "${GREEN}✓ Firewall configured${NC}"

# Install Traefik (optional - for automatic SSL)
echo "🔐 Setting up Traefik for SSL management..."
docker network create web 2>/dev/null || true

cat > /var/deploy/traefik-docker-compose.yml << 'EOF'
version: '3.8'

services:
  traefik:
    image: traefik:v3.0
    container_name: traefik
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    networks:
      - web
    ports:
      - 80:80
      - 443:443
    volumes:
      - /etc/localtime:/etc/localtime:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/data/traefik/traefik.yml:/traefik.yml:ro
      - /var/data/traefik/acme.json:/acme.json
      - /var/data/traefik/dynamic.yml:/dynamic.yml:ro
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.traefik.entrypoints=http"
      - "traefik.http.routers.traefik.rule=Host(`traefik.devpad.tools`)"
      - "traefik.http.middlewares.traefik-auth.basicauth.users=admin:$$2y$$10$$..."
      - "traefik.http.middlewares.traefik-https-redirect.redirectscheme.scheme=https"
      - "traefik.http.routers.traefik.middlewares=traefik-https-redirect"
      - "traefik.http.routers.traefik-secure.entrypoints=https"
      - "traefik.http.routers.traefik-secure.rule=Host(`traefik.devpad.tools`)"
      - "traefik.http.routers.traefik-secure.middlewares=traefik-auth"
      - "traefik.http.routers.traefik-secure.tls=true"
      - "traefik.http.routers.traefik-secure.tls.certresolver=letsencrypt"
      - "traefik.http.routers.traefik-secure.service=api@internal"

networks:
  web:
    external: true
EOF

# Create Traefik configuration
mkdir -p /var/data/traefik
cat > /var/data/traefik/traefik.yml << 'EOF'
api:
  dashboard: true
  debug: true

entryPoints:
  http:
    address: ":80"
    http:
      redirections:
        entrypoint:
          to: https
          scheme: https
  https:
    address: ":443"

providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
    network: web
  file:
    filename: /dynamic.yml
    watch: true

certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@devpad.tools
      storage: acme.json
      httpChallenge:
        entryPoint: http
EOF

# Create empty acme.json with correct permissions
touch /var/data/traefik/acme.json
chmod 600 /var/data/traefik/acme.json

# Create dynamic configuration
cat > /var/data/traefik/dynamic.yml << 'EOF'
http:
  middlewares:
    securityHeaders:
      headers:
        customResponseHeaders:
          X-Frame-Options: "SAMEORIGIN"
          X-Content-Type-Options: "nosniff"
          X-XSS-Protection: "1; mode=block"
EOF

echo -e "${GREEN}✓ Traefik configured${NC}"

# Create deployment helper scripts
echo "📝 Creating deployment helper scripts..."

# Create health check script
cat > /var/deploy/health-check.sh << 'EOF'
#!/bin/bash
ENVIRONMENT=${1:-production}
PORT=${2:-3000}

if [ "$ENVIRONMENT" = "staging" ]; then
    PORT=3001
fi

echo "🔍 Checking health of $ENVIRONMENT environment on port $PORT..."

if curl -f http://localhost:$PORT/health > /dev/null 2>&1; then
    echo "✅ $ENVIRONMENT is healthy"
    exit 0
else
    echo "❌ $ENVIRONMENT health check failed"
    exit 1
fi
EOF

chmod +x /var/deploy/health-check.sh

# Create backup script
cat > /var/deploy/backup.sh << 'EOF'
#!/bin/bash
ENVIRONMENT=${1:-production}
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

if [ "$ENVIRONMENT" = "production" ]; then
    DB_PATH="/var/data/devpad-production/devpad.db"
    BACKUP_PATH="/var/backups/devpad/production"
else
    DB_PATH="/var/data/devpad-staging/devpad-staging.db"
    BACKUP_PATH="/var/backups/devpad/staging"
fi

mkdir -p $BACKUP_PATH

echo "📦 Backing up $ENVIRONMENT database..."
cp $DB_PATH $BACKUP_PATH/devpad_${ENVIRONMENT}_${TIMESTAMP}.db

# Keep only last 30 backups
ls -t $BACKUP_PATH/*.db | tail -n +31 | xargs rm -f 2>/dev/null || true

echo "✅ Backup completed: devpad_${ENVIRONMENT}_${TIMESTAMP}.db"
EOF

chmod +x /var/deploy/backup.sh

echo -e "${GREEN}✓ Helper scripts created${NC}"

# Create systemd service for auto-start
echo "⚙️ Creating systemd services..."

cat > /etc/systemd/system/devpad-production.service << EOF
[Unit]
Description=devpad Production
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/var/deploy/devpad
ExecStart=/usr/local/bin/docker-compose -f docker-compose.production.yml up -d
ExecStop=/usr/local/bin/docker-compose -f docker-compose.production.yml down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/devpad-staging.service << EOF
[Unit]
Description=devpad Staging
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/var/deploy/devpad-staging
ExecStart=/usr/local/bin/docker-compose -f docker-compose.staging.yml up -d
ExecStop=/usr/local/bin/docker-compose -f docker-compose.staging.yml down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
echo -e "${GREEN}✓ Systemd services created${NC}"

# Create cron jobs for backups
echo "⏰ Setting up automated backups..."
(crontab -l 2>/dev/null; echo "0 2 * * * /var/deploy/backup.sh production") | crontab -
(crontab -l 2>/dev/null; echo "0 3 * * * /var/deploy/backup.sh staging") | crontab -
echo -e "${GREEN}✓ Automated backups configured${NC}"

# Final instructions
echo ""
echo "✨ ${GREEN}VPS Setup Complete!${NC}"
echo ""
echo "📋 Next steps:"
echo "1. Copy your Docker Compose files to:"
echo "   - /var/deploy/devpad/docker-compose.production.yml"
echo "   - /var/deploy/devpad-staging/docker-compose.staging.yml"
echo ""
echo "2. Set up GitHub secrets in your repository:"
echo "   - SSH_HOST (this server's IP)"
echo "   - SSH_HOST_STAGING (this server's IP)"
echo "   - SSH_USER (root or deployment user)"
echo "   - SSH_PORT (22 or custom)"
echo "   - SSH_KEY (deployment SSH private key)"
echo ""
echo "3. Start Traefik for SSL management:"
echo "   cd /var/deploy && docker-compose -f traefik-docker-compose.yml up -d"
echo ""
echo "4. Deploy your applications:"
echo "   - Production: systemctl start devpad-production"
echo "   - Staging: systemctl start devpad-staging"
echo ""
echo "5. Check health status:"
echo "   - /var/deploy/health-check.sh production"
echo "   - /var/deploy/health-check.sh staging"
echo ""
echo "🔒 Security notes:"
echo "- Change default passwords"
echo "- Set up SSH key-only authentication"
echo "- Configure fail2ban for additional security"
echo "- Regular security updates: apt-get update && apt-get upgrade"