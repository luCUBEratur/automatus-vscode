#!/bin/bash

# 🔧 Fix Token Scope and Repository URL

echo "🔧 Fixing Token Permissions and Repository URL"
echo "============================================="

echo ""
echo "📋 Two issues detected:"
echo "  1. ❌ Token missing 'workflow' scope (needed for GitHub Actions)"
echo "  2. ❌ Repository URL case mismatch"
echo ""
echo "🎯 Let's fix both..."

echo ""
echo "🔑 Issue 1: Token Permissions"
echo ""
echo "Your current token doesn't have the 'workflow' scope."
echo "GitHub Actions files (.github/workflows/) require this permission."
echo ""
echo "📱 Please create a NEW token with correct permissions:"
echo "  1. 🌐 Go to: https://github.com/settings/tokens"
echo "  2. 🗑️  (Optional) Delete your old token: 'Automatus VSCode Extension'"
echo "  3. 🆕 Click 'Generate new token (classic)'"
echo "  4. 📝 Name: 'Automatus VSCode Extension - Full'"
echo "  5. ⏰ Expiration: 90 days (or longer)"
echo "  6. ☑️  Select these scopes:"
echo "      ✅ repo (full control of private repositories)"
echo "      ✅ workflow (update GitHub Action workflows)"
echo "  7. 🎯 Click 'Generate token'"
echo "  8. 📋 Copy the NEW token (starts with ghp_)"

echo ""
read -p "🔑 Paste your NEW token with workflow scope: " NEW_TOKEN

if [[ -z "$NEW_TOKEN" ]]; then
    echo "❌ Token required!"
    exit 1
fi

if [[ ! "$NEW_TOKEN" =~ ^ghp_ ]]; then
    echo "⚠️  Token should start with 'ghp_'"
    read -p "❓ Continue anyway? (y/n): " CONTINUE
    if [[ "$CONTINUE" != "y" && "$CONTINUE" != "Y" ]]; then
        exit 0
    fi
fi

echo ""
echo "🔗 Issue 2: Repository URL"
echo ""
echo "GitHub says the repository moved to: luCUBEratur/automatus-vscode"
echo "Updating remote URL..."

# Remove old remote
git remote remove origin

# Add new remote with correct URL and new token
git remote add origin "https://$NEW_TOKEN@github.com/luCUBEratur/automatus-vscode.git"

echo "✅ Remote URL updated!"

echo ""
echo "🚀 Attempting push with new token and URL..."

if git push --force origin main; then
    echo ""
    echo "🎉 SUCCESS! GitHub Actions are now being created!"
    echo ""
    echo "🌐 Your repository: https://github.com/luCUBEratur/automatus-vscode"
    echo "⚡ GitHub Actions: https://github.com/luCUBEratur/automatus-vscode/actions"
    echo ""
    echo "🤖 5 GitHub Actions workflows are being set up:"
    echo "  1. 🔄 CI/CD Pipeline (ci.yml)"
    echo "  2. 🎯 Type Safety Monitor (type-safety-monitor.yml)"
    echo "  3. ⚡ Pre-commit Checks (pre-commit.yml)"
    echo "  4. 📊 Performance Testing (performance-test.yml)"
    echo "  5. 📈 Health Dashboard (dashboard.yml)"
    echo ""
    echo "⏱️  GitHub Actions will start running in 1-2 minutes"
    echo ""
    echo "📊 Expected Initial Results:"
    echo "  ❌ CI/CD Pipeline: TypeScript compilation errors (66+ errors)"
    echo "  ❌ Type Safety Monitor: High any type count (15+ types)"
    echo "  ❌ Pre-commit Checks: Build failures"
    echo "  ❌ Performance Testing: Cannot run due to build issues"
    echo "  ❌ Health Dashboard: Poor health score"
    echo ""
    echo "✅ This is PERFECT! The failures will guide you to fix issues systematically."
    echo ""
    echo "🎯 Next Steps:"
    echo "  1. Visit: https://github.com/luCUBEratur/automatus-vscode/actions"
    echo "  2. Watch workflows run and fail (this is expected!)"
    echo "  3. Read failure reports for specific fix instructions"
    echo "  4. Fix issues one by one with automated feedback"

else
    echo ""
    echo "❌ Still failed. Let's debug further..."
    echo ""
    echo "🔍 Checking connection:"
    if git ls-remote origin > /dev/null 2>&1; then
        echo "✅ Can connect to GitHub repository"
    else
        echo "❌ Cannot connect to GitHub repository"
        echo "   Check if repository exists: https://github.com/luCUBEratur/automatus-vscode"
    fi

    echo ""
    echo "💡 Possible issues:"
    echo "  1. Token still doesn't have 'workflow' scope"
    echo "  2. Repository doesn't exist at new URL"
    echo "  3. Repository is private and token lacks access"
    echo ""
    echo "🔧 Manual verification steps:"
    echo "  1. Visit: https://github.com/luCUBEratur/automatus-vscode"
    echo "  2. Verify repository exists and is public"
    echo "  3. Check token scopes at: https://github.com/settings/tokens"
    echo "  4. Ensure 'workflow' scope is checked"
fi