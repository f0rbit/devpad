# Versioning Strategy

devpad uses a three-component versioning system: `<major>.<release>.<pr>`

## Version Components

- **Major**: Breaking changes (manually controlled)
- **Release**: Production releases (auto-incremented on production deploy)
- **PR**: Staging deployments (auto-incremented per merge to main)

## Version Branch

Version tracking is maintained in a separate `versions` branch to:
1. Keep the main branch clean from version update commits
2. Bypass protected branch rules for automated updates
3. Maintain a clear version history

### Version Files (on `versions` branch)

- `VERSION_MAJOR` - Major version number
- `VERSION_RELEASE` - Release counter  
- `VERSION_PR` - PR/staging counter
- `VERSION` - Current full version string

## Workflow

### Staging Deployments (main branch merges)
1. PR is merged to main
2. GitHub Action calculates next version (increments PR counter)
3. Updates version files on `versions` branch
4. Deploys with version `1.0.<pr>-staging`

### Production Releases
1. Manual trigger or GitHub release created
2. Increments RELEASE counter, resets PR to 0
3. Updates version files on `versions` branch
4. Promotes staging image to production
5. Tags as `1.<release>.0`

### Major Version Bumps
1. Manually edit `VERSION_MAJOR` on versions branch
2. Next deployment will use new major version

## Initial Setup

To initialize the versions branch in your repository:

```bash
# Run the initialization script
./scripts/init-versions-branch.sh

# Push the new branch to remote
git push -u origin versions

# Return to main branch
git checkout main
```

## Examples

- First PR after setup: `1.0.1`
- Second PR: `1.0.2`
- First production release: `1.1.0` (resets PR counter)
- Next PR after release: `1.1.1`
- Major version bump: `2.0.0`