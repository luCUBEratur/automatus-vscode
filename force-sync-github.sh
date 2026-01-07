#!/bin/bash

# 🔧 Force Sync with GitHub - Fix the Branch Behind Issue

echo "🔧 Fixing GitHub Sync Issue"
echo "==========================="

echo ""
echo "📋 The Problem:"
echo "  Your local branch is behind the GitHub branch"
echo "  GitHub has commits (probably README.md) that you don't have"
echo ""
echo "🎯 The Solution:"
echo "  Pull GitHub's changes, then push your code"

# Check if we have the right remote
if ! git remote get-url origin >/dev/null 2>&1; then
    echo "❌ No GitHub remote configured. Run simple-github-setup.sh first"
    exit 1
fi

echo ""
echo "🔄 Step 1: Fetch latest from GitHub..."
git fetch origin

echo ""
echo "🔄 Step 2: Check what's different..."

# Check if we need to merge
if git rev-list HEAD..origin/main --count >/dev/null 2>&1; then
    BEHIND_COUNT=$(git rev-list HEAD..origin/main --count)
    echo "📊 Your local repo is $BEHIND_COUNT commits behind GitHub"
else
    echo "📊 Checking differences..."
fi

echo ""
echo "🔄 Step 3: Merge GitHub's changes..."

# Try to merge with strategy preference for our files
if git merge origin/main --allow-unrelated-histories -m "Merge GitHub changes with local development

- Integrating GitHub's default files with local codebase
- Prioritizing local Automatus implementation
- Resolving any conflicts in favor of local development"; then
    echo "✅ Merge successful!"
else
    echo "⚠️  Merge conflicts detected. Auto-resolving..."

    # Auto-resolve conflicts by keeping our files for code, GitHub's for docs
    echo "🔧 Resolving conflicts intelligently..."

    # If README.md conflicts, we'll choose GitHub's (it's probably better formatted)
    if [[ -f "README.md" ]] && git status | grep -q "README.md"; then
        echo "  📝 Keeping GitHub's README.md (better formatted)"
        git checkout --theirs README.md
    fi

    # For all other files, keep ours (our code is more important)
    for file in $(git diff --name-only --diff-filter=U); do
        if [[ "$file" != "README.md" ]]; then
            echo "  📁 Keeping local: $file"
            git checkout --ours "$file"
        fi
    done

    # Stage all resolved files
    git add .

    # Complete the merge
    git commit -m "Resolve merge conflicts: keep local code, accept GitHub docs

- Local Automatus implementation takes priority
- GitHub's documentation and default files accepted where appropriate
- All conflicts resolved automatically"

    echo "✅ Conflicts resolved automatically!"
fi

echo ""
echo "🚀 Step 4: Push everything to GitHub..."

# Now push should work
if git push origin main; then
    echo ""
    echo "🎉 SUCCESS! Your code is now on GitHub!"
    echo ""
    echo "🌐 Repository: https://github.com/lucuberatur/automatus-vscode"
    echo "⚡ Actions: https://github.com/lucuberatur/automatus-vscode/actions"
    echo ""
    echo "🤖 GitHub Actions are now running!"
    echo ""
    echo "📊 You should see 5 workflows starting:"
    echo "  1. 🔄 CI/CD Pipeline"
    echo "  2. 🎯 Type Safety Monitor"
    echo "  3. ⚡ Pre-commit Checks"
    echo "  4. 📊 Performance Testing"
    echo "  5. 📈 Health Dashboard"
    echo ""
    echo "💡 Expected initial results:"
    echo "  ❌ Most workflows will FAIL initially (this is good!)"
    echo "  📋 They'll show you exactly what needs to be fixed"
    echo "  🎯 Follow the failure reports to systematically fix issues"
    echo ""
    echo "🎯 Next steps:"
    echo "  1. Visit the Actions tab"
    echo "  2. Watch the workflows run"
    echo "  3. Read the failure reports carefully"
    echo "  4. Fix issues one by one"
    echo "  5. Push fixes and watch automated validation"

else
    echo ""
    echo "❌ Push still failed. Let's check what's happening..."

    echo ""
    echo "🔍 Current status:"
    git status --short

    echo ""
    echo "🔍 Remote status:"
    git remote -v

    echo ""
    echo "🔍 Branch status:"
    git branch -vv

    echo ""
    echo "💡 Manual fix options:"
    echo "  1. Force push (DANGEROUS): git push --force origin main"
    echo "  2. Check GitHub repository permissions"
    echo "  3. Verify your token still works"
    echo ""
    echo "❓ Want to try force push? (This will overwrite GitHub)"
    read -p "   Type 'yes' to force push: " FORCE_CONFIRM

    if [[ "$FORCE_CONFIRM" == "yes" ]]; then
        echo "⚠️  Force pushing..."
        if git push --force origin main; then
            echo "✅ Force push successful!"
        else
            echo "❌ Even force push failed. Check your GitHub permissions."
        fi
    else
        echo "⏸️  Skipping force push. Please check GitHub repository manually."
    fi
fi