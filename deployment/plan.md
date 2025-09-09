# Comprehensive CI/CD & Deployment Plan for devpad

## 📋 Executive Summary

Transform the current single-environment deployment into a robust dual-environment (staging/production) system with automatic versioning, comprehensive testing, and monitoring capabilities.

## 🎯 Objectives

1. **Automatic Versioning**: Implement `<major>.<release>.<pr>` versioning without manual tracking
2. **Dual Environments**: Separate staging and production deployments
3. **Continuous Testing**: Run tests on every push
4. **Zero-Downtime Deployments**: Blue-green deployment strategy
5. **Monitoring & Logging**: CLI tools for health checks and log analysis

## 🔢 Versioning System Design

### Version Format: `<major>.<release>.<pr>`

#### Components:
- **Major**: Breaking changes (manually controlled)
- **Release**: Production releases (auto-incremented)
- **PR**: Staging deployments (auto-incremented per PR)

### Version Storage Strategy:
```
.github/
├── VERSION              # Current version (e.g., "1.2.3")
├── VERSION_MAJOR        # Major version (e.g., "1")
└── VERSION_RELEASE      # Release counter (e.g., "2")
```

### Version Flow Examples:

#### Scenario 1: Normal PR Flow
```
Current Production: 1.2.0
PR #45 merged → Staging: 1.2.1
PR #46 merged → Staging: 1.2.2
PR #47 merged → Staging: 1.2.3
Create Release → Production: 1.3.0 (resets PR counter)
```

#### Scenario 2: Hotfix Flow
```
Current Production: 1.3.0
Hotfix PR #48 → Staging: 1.3.1
Emergency Release → Production: 1.4.0
```

#### Scenario 3: Major Version Bump
```
Current Production: 1.5.0
Update VERSION_MAJOR to "2"
PR #50 merged → Staging: 2.0.1
Create Release → Production: 2.1.0
```

### Edge Cases Handled:

1. **Concurrent PRs**: Use PR number as tiebreaker for version conflicts
2. **Rollback Needed**: Keep last 5 versions in registry, tag rollback with `-rollback`
3. **Failed Deployments**: Automatic rollback to previous version
4. **Version Conflicts**: Use GitHub's concurrency groups to prevent race conditions
5. **Manual Override**: Support `workflow_dispatch` with custom version input

## 🏗️ Infrastructure Architecture

### Environment Setup:

```
┌─────────────────────────────────────────┐
│            GitHub Actions               │
├─────────────┬───────────┬───────────────┤
│    Test     │  Staging  │  Production   │
└─────────────┴─────┬─────┴───────┬───────┘
                    │             │
              ┌─────▼─────┐ ┌─────▼─────┐
              │  GHCR.io  │ │  GHCR.io  │
              │  Staging  │ │Production │
              └─────┬─────┘ └─────┬─────┘
                    │             │
         ┌──────────▼─────────────▼──────────┐
         │         VPS (OVHCloud)            │
         ├────────────────────────────────────┤
         │  ┌─────────────┐ ┌─────────────┐ │
         │  │   Staging   │ │ Production  │ │
         │  │  Container  │ │  Container  │ │
         │  │   Port:3001 │ │  Port:3000  │ │
         │  └─────────────┘ └─────────────┘ │
         │  ┌─────────────┐ ┌─────────────┐ │
         │  │Staging DB   │ │Production DB│ │
         │  │/data/staging│ │/data/prod   │ │
         │  └─────────────┘ └─────────────┘ │
         └────────────────────────────────────┘
                    │             │
              ┌─────▼─────┐ ┌─────▼─────┐
              │  staging. │ │  devpad.  │
              │  devpad.  │ │   tools   │
              │   tools   │ └─────────────┘
              └───────────┘
```

### Docker Image Tags:
- **Production**: `ghcr.io/f0rbit/devpad:latest`, `ghcr.io/f0rbit/devpad:1.3.0`, `ghcr.io/f0rbit/devpad:stable`
- **Staging**: `ghcr.io/f0rbit/devpad:staging`, `ghcr.io/f0rbit/devpad:1.2.3-staging`
- **PR Builds**: `ghcr.io/f0rbit/devpad:pr-45`

## 📁 Files to Create/Modify

### 1. GitHub Actions Workflows

#### `.github/workflows/test.yml`
- **Triggers**: Every push, every PR
- **Jobs**:
  - Install dependencies
  - Run unit tests
  - Run integration tests
  - Generate coverage report
  - Type checking
  - Format checking
- **Edge Cases**:
  - Continue on non-critical failures (type/format)
  - Timeout after 15 minutes
  - Cache dependencies between runs

#### `.github/workflows/deploy-staging.yml`
- **Triggers**: Push to main, manual dispatch
- **Jobs**:
  - Calculate new version
  - Build Docker image
  - Push to GHCR with staging tags
  - Deploy to staging environment
  - Run smoke tests
  - Update VERSION file
- **Edge Cases**:
  - Lock deployments with concurrency group
  - Rollback on failure
  - Health check validation

#### `.github/workflows/deploy-production.yml`
- **Triggers**: Release published, manual dispatch
- **Jobs**:
  - Promote staging version to production
  - Re-tag Docker image
  - Deploy to production
  - Run smoke tests
  - Create GitHub release notes
- **Edge Cases**:
  - Require manual approval for major versions
  - Automatic rollback on health check failure
  - Keep backup of previous version

### 2. Version Management Files

#### `.github/VERSION`
- Current full version (e.g., "1.2.3")
- Updated by workflows automatically

#### `.github/VERSION_MAJOR`
- Major version number (e.g., "1")
- Updated manually for breaking changes

#### `.github/VERSION_RELEASE`
- Release counter (e.g., "2")
- Incremented on production releases

### 3. Deployment Scripts

#### `deployment/scripts/deploy.sh`
```bash
#!/bin/bash
# Generic deployment script for both environments
# Usage: ./deploy.sh <environment> <version>
```

#### `deployment/scripts/health-check.sh`
```bash
#!/bin/bash
# Health check script with retries
# Returns 0 if healthy, 1 if unhealthy
```

#### `deployment/scripts/rollback.sh`
```bash
#!/bin/bash
# Rollback to previous version
# Usage: ./rollback.sh <environment>
```

### 4. Docker Compose Files

#### `deployment/docker-compose.staging.yml`
- Staging-specific configuration
- Different ports (3001)
- Separate database volume
- Environment-specific variables

#### `deployment/docker-compose.production.yml`
- Production configuration
- Production ports (3000)
- Production database volume
- Production environment variables

### 5. VPS Setup Scripts

#### `deployment/vps/setup.sh`
- Initial VPS setup script
- Install Docker, Docker Compose
- Setup directories
- Configure nginx reverse proxy
- Setup SSL certificates

#### `deployment/vps/nginx.conf`
- Nginx configuration for both environments
- Proxy rules for staging.devpad.tools → localhost:3001
- Proxy rules for devpad.tools → localhost:3000

### 6. Monitoring Scripts

#### `scripts/monitor/logs.sh`
```bash
#!/bin/bash
# Stream logs with filtering and formatting
# Usage: ./logs.sh [staging|production] [--follow] [--filter=pattern]
```

#### `scripts/monitor/metrics.sh`
```bash
#!/bin/bash
# Display system metrics and container stats
# Shows: CPU, Memory, Disk, Network, Container health
```

#### `scripts/monitor/health.sh`
```bash
#!/bin/bash
# Quick health check of all services
# Shows: API status, DB connectivity, Version info
```

#### `scripts/monitor/backup.sh`
```bash
#!/bin/bash
# Backup database with rotation
# Keeps last 7 daily, 4 weekly, 12 monthly backups
```

## 🔄 Deployment Workflows

### PR Merge to Main (Staging Deployment):
1. GitHub Action triggers on merge
2. Calculate new version (increment PR number)
3. Build Docker image with new version
4. Push to GHCR with staging tags
5. SSH to VPS
6. Pull new image
7. Stop staging container
8. Start new staging container
9. Run health checks
10. If healthy: Update VERSION file, notify success
11. If unhealthy: Rollback, notify failure

### Create Release (Production Deployment):
1. GitHub Action triggers on release
2. Calculate new version (increment release, reset PR)
3. Re-tag staging image as production
4. SSH to VPS
5. Pull new image
6. Blue-green deployment:
   - Start new container on different port
   - Run health checks
   - Switch nginx proxy
   - Stop old container
7. If healthy: Update VERSION files, create release notes
8. If unhealthy: Switch back, notify failure

## 🔐 Security Considerations

### Secrets Required:
```
SSH_HOST_STAGING     # Staging VPS IP
SSH_HOST_PRODUCTION  # Production VPS IP
SSH_USER             # VPS username
SSH_PORT             # SSH port (non-standard recommended)
SSH_KEY              # SSH private key
GITHUB_TOKEN         # Already available
```

### Security Measures:
1. Use GitHub Environments for secret separation
2. Require reviews for production deployments
3. Implement deployment windows
4. Use non-root Docker user
5. Implement rate limiting on API
6. Regular security updates via Dependabot

## 📊 Monitoring & Logging Strategy

### Logging Architecture:
```
/var/log/devpad/
├── staging/
│   ├── app.log         # Application logs
│   ├── access.log      # HTTP access logs
│   ├── error.log       # Error logs
│   └── deploy.log      # Deployment logs
└── production/
    ├── app.log
    ├── access.log
    ├── error.log
    └── deploy.log
```

### Log Rotation:
- Daily rotation
- Compress after 1 day
- Delete after 30 days
- Keep critical logs for 90 days

### Metrics Collection:
- Container CPU/Memory usage
- Response times
- Error rates
- Database size
- Disk usage

## 🚨 Error Handling & Recovery

### Deployment Failures:
1. **Build Failure**: Notify team, block deployment
2. **Push Failure**: Retry 3 times, then manual intervention
3. **Health Check Failure**: Automatic rollback
4. **Database Migration Failure**: Rollback, restore backup
5. **Network Issues**: Retry with exponential backoff

### Rollback Strategy:
1. Keep last 5 versions available
2. One-command rollback: `./rollback.sh production`
3. Automatic rollback on health check failure
4. Database backup before migrations
5. Test rollback procedures monthly

## 🎬 Implementation Order

### Phase 1: Version Management (Day 1)
1. Create VERSION files
2. Create version calculation scripts
3. Test version incrementing logic

### Phase 2: Test Pipeline (Day 1)
1. Create test.yml workflow
2. Verify all tests pass
3. Add coverage reporting

### Phase 3: Staging Environment (Day 2)
1. Setup staging on VPS
2. Create staging Docker Compose
3. Create deploy-staging.yml
4. Test staging deployments

### Phase 4: Production Updates (Day 2)
1. Update production workflow
2. Implement blue-green deployment
3. Test production deployment

### Phase 5: Monitoring (Day 3)
1. Create monitoring scripts
2. Setup log rotation
3. Create backup procedures
4. Documentation

### Phase 6: Testing & Refinement (Day 3)
1. End-to-end testing
2. Load testing
3. Rollback testing
4. Documentation updates

## 📈 Success Metrics

- **Deployment Success Rate**: >99%
- **Mean Time to Deploy**: <5 minutes
- **Mean Time to Rollback**: <2 minutes
- **Test Coverage**: >80%
- **Zero-downtime deployments**: 100%

## 🔄 Maintenance Plan

### Daily:
- Check health metrics
- Review error logs

### Weekly:
- Review deployment metrics
- Check disk usage
- Verify backups

### Monthly:
- Security updates
- Dependency updates
- Rollback drill
- Performance review

This comprehensive plan covers all aspects of the CI/CD pipeline with proper error handling, security, and monitoring. Ready to proceed with implementation?