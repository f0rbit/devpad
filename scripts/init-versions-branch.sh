#!/bin/bash
set -e

echo "🚀 Initializing versions branch..."

# Store current branch
CURRENT_BRANCH=$(git branch --show-current)
echo "📍 Current branch: $CURRENT_BRANCH"

# Fetch latest from remote
echo "📥 Fetching latest from remote..."
git fetch origin

# Check if versions branch exists remotely
if git ls-remote --heads origin versions | grep -q versions; then
    echo "✅ Remote versions branch exists"
    
    # Check if we have it locally
    if git show-ref --verify --quiet refs/heads/versions; then
        echo "📌 Local versions branch exists, updating..."
        git checkout versions
        git pull origin versions --rebase
    else
        echo "📌 Creating local tracking branch..."
        git checkout -b versions origin/versions
    fi
else
    echo "⚠️  Remote versions branch doesn't exist"
    
    # Check if we have it locally
    if git show-ref --verify --quiet refs/heads/versions; then
        echo "📌 Local versions branch exists"
        git checkout versions
    else
        echo "📌 Creating new versions branch..."
        git checkout -b versions
    fi
fi

echo "📂 Current directory contents:"
ls -la

# Move version files to root if they're in .github
if [ -f .github/VERSION ]; then
    echo "📋 Found version files in .github/, keeping them there for compatibility"
    
    # Also create root level files for the workflow
    if [ ! -f VERSION ]; then
        cp .github/VERSION VERSION 2>/dev/null || echo "1.0.0" > VERSION
    fi
    if [ ! -f VERSION_MAJOR ]; then
        cp .github/VERSION_MAJOR VERSION_MAJOR 2>/dev/null || echo "1" > VERSION_MAJOR
    fi
    if [ ! -f VERSION_RELEASE ]; then
        cp .github/VERSION_RELEASE VERSION_RELEASE 2>/dev/null || echo "0" > VERSION_RELEASE
    fi
else
    echo "📝 Creating version files..."
    
    # Create .github directory if it doesn't exist
    mkdir -p .github
    
    # Create version files in .github with defaults if they don't exist
    if [ ! -f .github/VERSION ]; then
        echo "1.0.0" > .github/VERSION
    fi
    if [ ! -f .github/VERSION_MAJOR ]; then
        echo "1" > .github/VERSION_MAJOR
    fi
    if [ ! -f .github/VERSION_RELEASE ]; then
        echo "0" > .github/VERSION_RELEASE
    fi
    
    # Also create in root for workflow
    cp .github/VERSION VERSION
    cp .github/VERSION_MAJOR VERSION_MAJOR
    cp .github/VERSION_RELEASE VERSION_RELEASE
fi

# Create VERSION_PR counter if it doesn't exist
if [ ! -f VERSION_PR ]; then
    echo "0" > VERSION_PR
    echo "📊 Created VERSION_PR counter"
fi

# Show current version info
echo ""
echo "📦 Current version information:"
echo "  VERSION: $(cat VERSION)"
echo "  VERSION_MAJOR: $(cat VERSION_MAJOR)"
echo "  VERSION_RELEASE: $(cat VERSION_RELEASE)"
echo "  VERSION_PR: $(cat VERSION_PR)"

# Stage and commit if there are changes
if [ -n "$(git status --porcelain)" ]; then
    echo ""
    echo "💾 Committing version files..."
    git add .github/VERSION .github/VERSION_MAJOR .github/VERSION_RELEASE 2>/dev/null || true
    git add VERSION VERSION_MAJOR VERSION_RELEASE VERSION_PR
    git commit -m "chore: initialize/update version files" || echo "No changes to commit"
else
    echo "✨ No changes to commit"
fi

# Push to remote
echo ""
echo "📤 Pushing versions branch to origin..."
if git push -u origin versions; then
    echo "✅ Successfully pushed to origin/versions"
else
    echo "⚠️  Push failed, trying with force-with-lease..."
    git push origin versions --force-with-lease
fi

# Switch back to original branch
echo ""
echo "🔄 Switching back to $CURRENT_BRANCH..."
git checkout "$CURRENT_BRANCH"

echo ""
echo "✅ Version branch initialized successfully!"
echo ""
echo "📋 Summary:"
echo "  - Versions branch is set up and pushed to origin"
echo "  - Version files are in both .github/ and root of versions branch"
echo "  - Current version: $(cat .github/VERSION 2>/dev/null || echo 'Check versions branch')"
echo ""
echo "🎯 Next steps:"
echo "  1. The version-manager workflow will read from the versions branch"
echo "  2. Deployments will use versions from this branch"
echo "  3. Version bumps will be committed to the versions branch"