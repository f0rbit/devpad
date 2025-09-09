# devpad Deployment Infrastructure

This directory contains the complete deployment infrastructure for devpad, including CI/CD pipelines, Docker configurations, and monitoring tools.

## 🏗️ Architecture Overview

devpad uses a dual-environment deployment strategy with automatic versioning and zero-downtime deployments:

```
GitHub Repository → GitHub Actions → Docker Registry → VPS Deployment
                         ↓                                    ↓
                    [Test Suite]                    [Staging + Production]
```

### Environments

| Environment | URL | Port | Purpose |
|------------|-----|------|---------|
| **Production** | https://devpad.tools | 3000 | Live application |
| **Staging** | https://staging.devpad.tools | 3001 | Testing & validation |
| **Local** | http://localhost:4321 | 4321/3001 | Development |

## 📁 Directory Structure

```
deployment/
├── docker-compose.yml            # Local development compose
├── docker-compose.staging.yml    # Staging environment config
├── docker-compose.production.yml # Production environment config
├── Dockerfile                    # Multi-stage Docker build
├── production.ts                 # Production server entry
├── serverless.ts                 # Serverless deployment entry
├── migrate.ts                    # Database migration runner
├── plan.md                       # Comprehensive CI/CD plan
├── scripts/                      # Deployment helper scripts
└── vps/                          # VPS setup and configuration
    └── setup.sh                  # Complete VPS setup script

../.github/
├── VERSION                       # Current version (e.g., "1.2.3")
├── VERSION_MAJOR                 # Major version (e.g., "1")
├── VERSION_RELEASE               # Release counter (e.g., "2")
└── workflows/
    ├── test.yml                  # Test on every push
    ├── deploy-staging.yml        # Auto-deploy to staging
    └── deploy-production.yml     # Deploy to production

../scripts/monitor/
├── logs.sh                       # Log viewer with filtering
├── metrics.sh                    # Real-time metrics dashboard
└── health.sh                     # Health check utility
```

## 🚀 Deployment Pipeline

### Versioning System: `<major>.<release>.<pr>`

- **Major**: Manual bump for breaking changes
- **Release**: Auto-increment on production deploy
- **PR**: Auto-increment on staging deploy

#### Version Flow Example:
```
1.0.0 (production) 
  → PR merged → 1.0.1 (staging)
  → PR merged → 1.0.2 (staging)
  → Release → 1.1.0 (production)
```

### CI/CD Workflows

#### 1. **Test Pipeline** (`test.yml`)
- **Triggers**: Every push, every PR
- **Actions**: 
  - Run unit & integration tests
  - Type checking
  - Generate coverage report
  - Build verification

#### 2. **Staging Deployment** (`deploy-staging.yml`)
- **Triggers**: Push to main branch
- **Actions**:
  - Calculate new version
  - Build & push Docker image
  - Deploy to staging environment
  - Run smoke tests
  - Auto-rollback on failure

#### 3. **Production Deployment** (`deploy-production.yml`)
- **Triggers**: GitHub release published
- **Actions**:
  - Promote staging image
  - Blue-green deployment
  - Health verification
  - Auto-rollback on failure

## 🐳 Docker Configuration

### Building Images

```bash
# Build locally
docker build -f deployment/Dockerfile -t devpad .

# Build with specific version
docker build --build-arg VERSION=1.2.3 -f deployment/Dockerfile -t devpad:1.2.3 .
```

### Running Containers

```bash
# Production
docker-compose -f deployment/docker-compose.production.yml up -d

# Staging
docker-compose -f deployment/docker-compose.staging.yml up -d

# Local development
docker-compose -f deployment/docker-compose.yml up -d
```

## 🖥️ VPS Setup

### Initial Setup

Run the automated setup script on a fresh Ubuntu VPS:

```bash
# Download and execute setup script
curl -O https://raw.githubusercontent.com/f0rbit/devpad/main/deployment/vps/setup.sh
chmod +x setup.sh
sudo ./setup.sh
```

This script will:
- Install Docker & Docker Compose
- Configure Traefik for SSL management
- Set up directory structure
- Configure firewall
- Create systemd services
- Set up automated backups
- Configure log rotation

### Manual Deployment

```bash
# SSH into VPS
ssh user@your-vps-ip

# Navigate to deployment directory
cd /var/deploy/devpad

# Pull latest images
docker pull ghcr.io/f0rbit/devpad:latest
docker pull ghcr.io/f0rbit/devpad:staging

# Deploy production
docker-compose -f docker-compose.production.yml up -d

# Deploy staging
cd /var/deploy/devpad-staging
docker-compose -f docker-compose.staging.yml up -d
```

## 🔧 Configuration

### Environment Variables

#### Production
```env
NODE_ENV=production
PORT=3000
DATABASE_FILE=/app/data/devpad.db
CORS_ORIGINS=https://devpad.tools,https://www.devpad.tools
STATIC_FILES_PATH=./packages/app/dist/client
```

#### Staging
```env
NODE_ENV=staging
PORT=3000
DATABASE_FILE=/app/data/devpad-staging.db
CORS_ORIGINS=https://staging.devpad.tools
STATIC_FILES_PATH=./packages/app/dist/client
```

### GitHub Secrets Required

Configure these in your repository settings:

```yaml
SSH_HOST            # Production VPS IP address
SSH_HOST_STAGING    # Staging VPS IP (can be same as production)
SSH_USER            # SSH username for deployment
SSH_PORT            # SSH port (default: 22)
SSH_KEY             # SSH private key for authentication
GITHUB_TOKEN        # Automatically provided by GitHub Actions
```

## 📊 Monitoring & Maintenance

### Health Checks

```bash
# Check all environments
./scripts/monitor/health.sh all

# Check specific environment
./scripts/monitor/health.sh production
./scripts/monitor/health.sh staging
```

### Log Viewing

```bash
# View production logs
./scripts/monitor/logs.sh production

# Stream staging logs
./scripts/monitor/logs.sh staging --follow

# Filter for errors
./scripts/monitor/logs.sh production --filter="ERROR" --lines=500
```

### Metrics Dashboard

```bash
# View all metrics
./scripts/monitor/metrics.sh all

# View specific environment
./scripts/monitor/metrics.sh production
```

### Database Backups

Automated backups run daily at 2 AM (production) and 3 AM (staging):

```bash
# Manual backup
/var/deploy/backup.sh production
/var/deploy/backup.sh staging

# Restore from backup
sqlite3 /var/data/devpad-production/devpad.db < /var/backups/devpad/production/backup.db
```

## 🚨 Troubleshooting

### Common Issues

#### Container Won't Start
```bash
# Check logs
docker logs devpad-production
docker logs devpad-staging

# Check health
docker inspect devpad-production --format='{{.State.Health.Status}}'
```

#### Database Issues
```bash
# Check database file
ls -la /var/data/devpad-production/
ls -la /var/data/devpad-staging/

# Run migrations manually
docker exec devpad-production bun run migrate
```

#### Network Issues
```bash
# Check if ports are open
netstat -tulpn | grep -E "3000|3001"

# Check Traefik logs
docker logs traefik

# Test endpoints
curl http://localhost:3000/health
curl http://localhost:3001/health
```

### Rollback Procedure

#### Automatic Rollback
The deployment pipelines automatically rollback on failure.

#### Manual Rollback
```bash
# List available versions
docker images | grep devpad

# Stop current container
docker stop devpad-production

# Start previous version
docker run -d \
  --name devpad-production \
  --restart unless-stopped \
  -p 3000:3000 \
  -v /var/data/devpad-production:/app/data \
  ghcr.io/f0rbit/devpad:1.0.0  # Previous version
```

## 🔄 Development Workflow

### Local Development

```bash
# Start both API and frontend
bun run dev:all

# API server only
bun run dev:server

# Frontend only
bun run dev
```

### Testing Changes

```bash
# Run all tests
make test

# Run specific test suites
make unit
make integration

# Check coverage
make coverage
make coverage-report
```

### Deployment Flow

1. **Development**: Work on feature branch
2. **Testing**: Push to branch → automated tests run
3. **Staging**: Merge to main → auto-deploy to staging
4. **Production**: Create release → auto-deploy to production

## 📝 Deployment Scripts

### Server Entry Points

| File | Purpose | Usage |
|------|---------|-------|
| `production.ts` | Full-stack production server | `bun deployment/production.ts` |
| `serverless.ts` | API-only serverless | `bun deployment/serverless.ts` |
| `migrate.ts` | Run migrations only | `bun deployment/migrate.ts` |

### Quick Commands

```bash
# Development
bun run dev:all           # Start full stack locally
bun run dev:server        # API server only
bun run dev               # Frontend only

# Deployment
bun run deploy:production # Production server
bun run deploy:serverless # Serverless API
bun run deploy:migrate    # Run migrations

# Docker
make build                # Build Docker image
make run                  # Run Docker container
```

## 🔒 Security Considerations

1. **SSH Access**: Use key-based authentication only
2. **Firewall**: Only required ports are open (80, 443, 22)
3. **SSL**: Automatic via Traefik/Let's Encrypt
4. **Secrets**: Store in GitHub Secrets, never commit
5. **Database**: Regular automated backups
6. **Updates**: Regular security patches via apt

## 📚 Additional Resources

- [Full CI/CD Plan](./plan.md) - Comprehensive deployment strategy
- [VPS Setup Guide](./vps/setup.sh) - Automated server configuration
- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [Docker Compose Reference](https://docs.docker.com/compose/)
- [Traefik Documentation](https://doc.traefik.io/traefik/)

---

For issues or questions, check the logs first:
```bash
./scripts/monitor/logs.sh production --follow
./scripts/monitor/health.sh all
```