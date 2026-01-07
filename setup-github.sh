#!/bin/bash

# 🚀 GitHub Setup Script for Automatus VSCode Extension

echo "🎯 Automatus VSCode Extension - GitHub Setup"
echo "============================================"

# Check if we're in the right directory
if [[ ! -f "package.json" ]] || [[ ! -d ".github" ]]; then
    echo "❌ Error: Run this script from the VSCode extension root directory"
    echo "   Expected: /Users/keinobrown/Scripts/Automatus/automatus-vscode/automatus"
    exit 1
fi

echo ""
echo "📋 Current Status:"
echo "  ✅ Local git repository exists"
echo "  ✅ GitHub Actions workflows ready (.github/workflows/)"
echo "  ✅ Type safety tests created"
echo "  ❓ GitHub repository (you need to create this)"

echo ""
echo "🔧 Step 1: Create your GitHub repository"
echo "  1. Go to: https://github.com/new"
echo "  2. Repository name: automatus-vscode"
echo "  3. Description: AI-powered VSCode extension with safety-first architecture"
echo "  4. Make it PUBLIC (required for free GitHub Actions)"
echo "  5. DON'T initialize with README (you already have files)"
echo "  6. Click 'Create repository'"

echo ""
read -p "📝 Enter your GitHub username: " USERNAME

if [[ -z "$USERNAME" ]]; then
    echo "❌ Username is required!"
    exit 1
fi

echo ""
echo "🔗 Step 2: We'll configure git for GitHub"
echo "  Repository URL will be: https://github.com/$USERNAME/automatus-vscode"

read -p "❓ Have you created the GitHub repository? (y/n): " CREATED

if [[ "$CREATED" != "y" && "$CREATED" != "Y" ]]; then
    echo ""
    echo "⏸️  Please create the GitHub repository first, then run this script again."
    echo "   URL: https://github.com/new"
    exit 0
fi

echo ""
echo "🚀 Step 3: Setting up git and pushing to GitHub..."

# Configure git user if not set
if [[ -z "$(git config user.name)" ]]; then
    read -p "📝 Enter your name for git commits: " GIT_NAME
    git config user.name "$GIT_NAME"
fi

if [[ -z "$(git config user.email)" ]]; then
    read -p "📝 Enter your email for git commits: " GIT_EMAIL
    git config user.email "$GIT_EMAIL"
fi

# Add all files to git
echo "📦 Adding all files to git..."
git add .

# Create initial commit
echo "💾 Creating initial commit..."
git commit -m "Initial commit: Automatus VSCode Extension with GitHub Actions

✨ Features:
- TUI-VSCode bridge implementation with discriminated unions
- Comprehensive type safety testing
- GitHub Actions CI/CD pipeline
- Performance monitoring and regression detection
- Automated quality dashboard

🔧 GitHub Actions Workflows:
- CI/CD Pipeline (ci.yml)
- Type Safety Monitor (type-safety-monitor.yml)
- Pre-commit Checks (pre-commit.yml)
- Performance Testing (performance-test.yml)
- Health Dashboard (dashboard.yml)

🎯 Next Steps:
- Fix TypeScript compilation errors
- Update test suite for new type system
- Achieve type safety score >80"

# Set up GitHub remote
echo "🔗 Adding GitHub remote..."
git remote add origin "https://github.com/$USERNAME/automatus-vscode.git"

# Set main branch
git branch -M main

# Push to GitHub
echo "🚀 Pushing to GitHub..."
if git push -u origin main; then
    echo ""
    echo "🎉 SUCCESS! Your code is now on GitHub!"
    echo ""
    echo "🔍 Next Steps:"
    echo "  1. Go to: https://github.com/$USERNAME/automatus-vscode"
    echo "  2. Click the 'Actions' tab"
    echo "  3. Watch the GitHub Actions run (they will likely fail initially - this is expected!)"
    echo "  4. Review the failure reports to see what needs to be fixed"
    echo ""
    echo "📊 Expected Initial Results:"
    echo "  ❌ CI/CD Pipeline - TypeScript compilation errors"
    echo "  ❌ Type Safety Monitor - High any type count"
    echo "  ❌ Pre-commit Checks - Build failures"
    echo "  ❌ Performance Testing - Test suite issues"
    echo "  ❌ Health Dashboard - Overall poor health score"
    echo ""
    echo "✅ This is GOOD! The GitHub Actions are catching the issues we identified."
    echo "   We can now systematically fix them with fast feedback."
    echo ""
    echo "🎯 GitHub Repository: https://github.com/$USERNAME/automatus-vscode"
    echo "🎯 Actions Dashboard: https://github.com/$USERNAME/automatus-vscode/actions"
else
    echo ""
    echo "❌ Push failed! Common issues:"
    echo "  1. Repository doesn't exist on GitHub"
    echo "  2. Repository name mismatch (should be 'automatus-vscode')"
    echo "  3. Authentication issues"
    echo ""
    echo "🔧 Debug steps:"
    echo "  1. Verify repository exists: https://github.com/$USERNAME/automatus-vscode"
    echo "  2. Check repository is public"
    echo "  3. Try git push again"
fi