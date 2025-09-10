# Package Publishing Guide for devpad

This guide explains how to publish the devpad npm packages: `@devpad/api`, `@devpad/cli`, and `@devpad/mcp`.

## 📦 Published Packages

| Package | Description | npm | Usage |
|---------|-------------|-----|-------|
| `@devpad/api` | TypeScript API client | [![npm](https://img.shields.io/npm/v/@devpad/api)](https://www.npmjs.com/package/@devpad/api) | `npm install @devpad/api` |
| `@devpad/cli` | Command-line interface | [![npm](https://img.shields.io/npm/v/@devpad/cli)](https://www.npmjs.com/package/@devpad/cli) | `npm install -g @devpad/cli` |
| `@devpad/mcp` | Model Context Protocol server | [![npm](https://img.shields.io/npm/v/@devpad/mcp)](https://www.npmjs.com/package/@devpad/mcp) | `npm install @devpad/mcp` |

## 🚀 Automatic Publishing

Packages are automatically published to npm when:

1. **Code changes are merged to main** - Only changed packages are published
2. **Manual trigger via GitHub Actions** - Publish specific packages on demand
3. **GitHub Release is created** - All packages are published with new version

### How It Works

1. **Change Detection**: The workflow detects which packages have changed since the last release
2. **Version Bumping**: Versions are automatically incremented based on the versioning strategy
3. **Build & Test**: Packages are built and tested before publishing
4. **Publishing**: Changed packages are published to npm
5. **Tagging**: Git tags are created for each published version

## 📝 Versioning Strategy

All packages share the same version number for consistency: `<major>.<release>.<pr>`

- **Major**: Breaking changes (manually updated)
- **Release**: Production releases (auto-incremented)
- **PR**: Patch versions (auto-incremented per PR)

### Version Files

```
.github/
├── VERSION          # Current version (e.g., "1.2.3")
├── VERSION_MAJOR    # Major version (e.g., "1")
└── VERSION_RELEASE  # Release counter (e.g., "2")
```

## 🔧 Manual Publishing

### Prerequisites

1. **NPM Token**: Set up `NPM_TOKEN` in GitHub Secrets
2. **Permissions**: Ensure you have publish rights to `@devpad` scope

### Via GitHub Actions (Recommended)

1. Go to [Actions → Publish Packages](https://github.com/f0rbit/devpad/actions/workflows/publish-packages.yml)
2. Click "Run workflow"
3. Select options:
   - **Packages**: Choose which packages to publish (e.g., "api,cli" or "all")
   - **Version bump**: Choose version increment type (patch/minor/major/none)
   - **Dry run**: Test without actually publishing
4. Click "Run workflow"

### Via Command Line

#### 1. Sync Versions

```bash
# Use current version from .github/VERSION
node scripts/sync-versions.js

# Bump patch version
node scripts/sync-versions.js --bump patch

# Bump minor version
node scripts/sync-versions.js --bump minor

# Bump major version
node scripts/sync-versions.js --bump major

# Set specific version
node scripts/sync-versions.js --version 2.0.0
```

#### 2. Prepare Package for Publishing

```bash
# Prepare a specific package
node scripts/prepare-publish.js api 1.2.3
node scripts/prepare-publish.js cli 1.2.3
node scripts/prepare-publish.js mcp 1.2.3
```

#### 3. Publish to npm

```bash
cd packages/api
npm publish --access public

cd packages/cli
npm publish --access public

cd packages/mcp
npm publish --access public
```

#### 4. Create Git Tags

```bash
# Tag the monorepo version
git tag -a "v1.2.3" -m "Release v1.2.3"

# Tag individual packages
git tag -a "@devpad/api@1.2.3" -m "Release @devpad/api@1.2.3"
git tag -a "@devpad/cli@1.2.3" -m "Release @devpad/cli@1.2.3"
git tag -a "@devpad/mcp@1.2.3" -m "Release @devpad/mcp@1.2.3"

# Push tags
git push origin --tags
```

## 🔍 Change Detection

The publishing workflow automatically detects changes by:

1. Comparing files with the last git tag
2. Checking if dependencies have changed
3. Detecting changes in shared packages (e.g., schema changes affect all packages)

### Force Publishing

To force publish without changes:

1. Use GitHub Actions with manual trigger
2. Select the packages you want to publish
3. The workflow will skip change detection

## 📋 Pre-Publishing Checklist

Before publishing, ensure:

- [ ] All tests pass (`make test`)
- [ ] Build succeeds (`bun run build`)
- [ ] Version is updated correctly
- [ ] CHANGELOG is updated (if applicable)
- [ ] README is up to date
- [ ] No sensitive information in code
- [ ] Dependencies are up to date

## 🐛 Troubleshooting

### Common Issues

#### 1. "Package not found" error
```bash
# Ensure package is built
cd packages/api
bun run build
```

#### 2. "workspace:* not allowed" error
```bash
# Run prepare-publish script to replace workspace dependencies
node scripts/prepare-publish.js api 1.2.3
```

#### 3. "Version already exists" error
```bash
# Bump to next version
node scripts/sync-versions.js --bump patch
```

#### 4. "Permission denied" error
- Check NPM_TOKEN is set in GitHub Secrets
- Verify you have publish rights to @devpad scope

### Rollback a Published Version

```bash
# Deprecate a broken version
npm deprecate @devpad/api@1.2.3 "Contains critical bug, use 1.2.4"

# Unpublish (within 72 hours only)
npm unpublish @devpad/api@1.2.3
```

## 🏷️ Git Tags

Each publish creates multiple tags:

- `v1.2.3` - Monorepo version tag
- `@devpad/api@1.2.3` - Package-specific tag
- `@devpad/cli@1.2.3` - Package-specific tag
- `@devpad/mcp@1.2.3` - Package-specific tag

To list all tags:
```bash
git tag -l "v*"          # List version tags
git tag -l "@devpad/*"   # List package tags
```

## 📊 Monitoring Published Packages

Check package status:

```bash
# View package info
npm view @devpad/api
npm view @devpad/cli
npm view @devpad/mcp

# Check latest version
npm view @devpad/api version
npm view @devpad/cli version
npm view @devpad/mcp version

# View all published versions
npm view @devpad/api versions
npm view @devpad/cli versions
npm view @devpad/mcp versions
```

## 🔐 Security

- **NPM Token**: Store securely in GitHub Secrets
- **2FA**: Enable two-factor authentication on npm account
- **Scoped Packages**: All packages use `@devpad` scope
- **Access Control**: Limit publish access to maintainers only

## 📚 Package-Specific Notes

### @devpad/api
- Main TypeScript API client
- Includes Result type for error handling
- Tree-shakeable exports

### @devpad/cli
- Global CLI tool
- Executable: `devpad`
- Requires Node.js 18+

### @devpad/mcp
- MCP server implementation
- Executable: `devpad-mcp`
- Compatible with Claude Desktop and other MCP clients

## 🆘 Getting Help

- **Issues**: [GitHub Issues](https://github.com/f0rbit/devpad/issues)
- **Discussions**: [GitHub Discussions](https://github.com/f0rbit/devpad/discussions)
- **Documentation**: [devpad.tools](https://devpad.tools)

## 📝 Release Process Summary

1. **Development**: Work on feature branches
2. **Review**: Create PR to main branch
3. **Merge**: Merge PR (triggers staging deployment)
4. **Publish**: Packages auto-publish if changed
5. **Release**: Create GitHub release for production
6. **Monitor**: Check npm and GitHub for successful publish

---

For more details on the CI/CD pipeline, see [deployment/README.md](deployment/README.md).