#!/bin/bash

# 🚀 Simple GitHub Setup - Just Get It Working!

echo "🚀 Simple GitHub Authentication Setup"
echo "===================================="

# Check directory
if [[ ! -f "package.json" ]]; then
    echo "❌ Run this from the VSCode extension directory"
    exit 1
fi

echo ""
echo "🔐 GitHub Authentication Required"
echo ""
echo "GitHub no longer accepts passwords. You need a Personal Access Token."
echo ""
echo "📋 Steps to get your token:"
echo "  1. 🌐 Go to: https://github.com/settings/tokens"
echo "  2. 🆕 Click 'Generate new token (classic)'"
echo "  3. 📝 Name: 'Automatus VSCode Extension'"
echo "  4. ⏰ Expiration: 90 days (or longer)"
echo "  5. ☑️  Check scope: 'repo' (full control of private repositories)"
echo "  6. 🎯 Click 'Generate token'"
echo "  7. 📋 Copy the token (it looks like: ghp_xxxxxxxxxxxx)"

echo ""
read -p "🔑 Paste your Personal Access Token here (starts with ghp_): " GITHUB_TOKEN

# Validate token format
if [[ -z "$GITHUB_TOKEN" ]]; then
    echo "❌ Error: Token cannot be empty!"
    exit 1
fi

if [[ ! "$GITHUB_TOKEN" =~ ^ghp_ ]]; then
    echo "⚠️  Warning: Token should start with 'ghp_'"
    read -p "❓ Continue anyway? (y/n): " CONTINUE
    if [[ "$CONTINUE" != "y" && "$CONTINUE" != "Y" ]]; then
        echo "⏸️  Please get the correct token and try again"
        exit 0
    fi
fi

echo ""
echo "🔧 Setting up authentication..."

# Remove existing origin (if any)
git remote remove origin 2>/dev/null || true

# Add origin with token
git remote add origin "https://$GITHUB_TOKEN@github.com/lucuberatur/automatus-vscode.git"

echo "✅ Authentication configured!"

echo ""
echo "📦 Syncing with GitHub repository..."

# First, let's see what's on GitHub
echo "🔍 Checking what's in the GitHub repository..."

# Try to fetch to see what's there
if git fetch origin main 2>/dev/null; then
    echo "✅ Connected to GitHub successfully!"

    # Check if there are differences
    if git rev-list HEAD..origin/main --count > /dev/null 2>&1; then
        COMMITS_BEHIND=$(git rev-list HEAD..origin/main --count 2>/dev/null || echo "unknown")
        if [[ "$COMMITS_BEHIND" -gt 0 ]]; then
            echo "📋 GitHub has $COMMITS_BEHIND commit(s) that you don't have locally"
            echo "   (Probably README.md or other files GitHub created)"
            echo ""
            echo "🔄 Pulling changes from GitHub..."

            if git pull origin main --allow-unrelated-histories; then
                echo "✅ Successfully merged GitHub's files!"
            else
                echo "⚠️  Merge conflicts detected. Let's resolve them..."
                echo ""
                echo "🎯 Automatic resolution: keeping your files (they're more important)"

                # Resolve conflicts by keeping our files
                git checkout --ours .
                git add .
                git commit -m "Merge: resolve conflicts keeping local files

- Keep local Automatus VSCode extension files
- GitHub created default files that conflicted
- Local implementation is the main codebase"

                echo "✅ Conflicts resolved automatically!"
            fi
        fi
    fi
else
    echo "ℹ️  GitHub repository might be empty or there's a connection issue"
fi

echo ""
echo "🚀 Pushing your code to GitHub..."

# Push to GitHub
if git push -u origin main; then
    echo ""
    echo "🎉 SUCCESS! Your code is on GitHub!"
    echo ""
    echo "🔗 Your repository: https://github.com/lucuberatur/automatus-vscode"
    echo "⚡ GitHub Actions: https://github.com/lucuberatur/automatus-vscode/actions"
    echo ""
    echo "🤖 GitHub Actions will start running automatically!"
    echo "   They will likely fail initially (this is expected and good)"
    echo "   The failures will show you exactly what needs to be fixed"
    echo ""
    echo "🎯 Next steps:"
    echo "  1. Visit the Actions tab to see the workflows running"
    echo "  2. Review the failure reports (they'll guide you to fixes)"
    echo "  3. Make fixes based on the automated feedback"
    echo "  4. Push changes and watch GitHub Actions validate them"

else
    echo ""
    echo "❌ Push failed. Let's diagnose..."
    echo ""
    echo "🔍 Debugging info:"
    echo "Remote URL: $(git remote get-url origin)"
    echo ""
    echo "🔧 Common issues:"
    echo "  1. Token doesn't have 'repo' scope"
    echo "  2. Repository isn't public"
    echo "  3. Token was typed incorrectly"
    echo ""
    echo "💡 Try:"
    echo "  1. Double-check your token has 'repo' permission"
    echo "  2. Verify repository exists: https://github.com/lucuberatur/automatus-vscode"
    echo "  3. Run this script again with a fresh token"
fi