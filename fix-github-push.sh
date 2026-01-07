#!/bin/bash

# 🔧 Fix GitHub Push Issues

echo "🔧 Fixing GitHub Push Issues"
echo "============================"

echo ""
echo "📋 The Issue:"
echo "  Your GitHub repo has files that aren't in your local repo"
echo "  (GitHub probably created README.md or other default files)"
echo ""
echo "🔐 Authentication Issue:"
echo "  GitHub no longer accepts passwords for git operations"
echo "  You need a Personal Access Token (PAT)"

echo ""
echo "🎯 Let's fix both issues step by step..."

# Check if we're in the right directory
if [[ ! -f "package.json" ]] || [[ ! -d ".github" ]]; then
    echo "❌ Error: Run this script from the VSCode extension root directory"
    exit 1
fi

echo ""
echo "📝 Step 1: Set up GitHub Authentication"
echo ""
echo "You have 3 options:"
echo ""
echo "🔑 Option A: Personal Access Token (Recommended)"
echo "  1. Go to: https://github.com/settings/tokens"
echo "  2. Click 'Generate new token (classic)'"
echo "  3. Give it a name: 'Automatus VSCode Extension'"
echo "  4. Select scopes: repo (full control of private repositories)"
echo "  5. Click 'Generate token'"
echo "  6. Copy the token (starts with ghp_)"
echo ""
echo "🔑 Option B: GitHub CLI (if you want to install it)"
echo "  brew install gh"
echo "  gh auth login"
echo ""
echo "🔑 Option C: SSH Keys (if you prefer SSH)"
echo "  Use SSH URL instead of HTTPS"

read -p "❓ Which option do you want to use? (A/B/C): " AUTH_OPTION

if [[ "$AUTH_OPTION" == "A" || "$AUTH_OPTION" == "a" ]]; then
    echo ""
    echo "🔑 Setting up Personal Access Token..."
    echo ""
    echo "📱 Please:"
    echo "  1. Go to: https://github.com/settings/tokens"
    echo "  2. Click 'Generate new token (classic)'"
    echo "  3. Name: 'Automatus VSCode Extension'"
    echo "  4. Expiration: 90 days (or longer)"
    echo "  5. Select scope: ☑️ repo"
    echo "  6. Click 'Generate token'"
    echo "  7. Copy the token (it starts with 'ghp_')"
    echo ""
    read -p "📋 Paste your Personal Access Token here: " PAT_TOKEN

    if [[ -z "$PAT_TOKEN" ]]; then
        echo "❌ Token is required!"
        exit 1
    fi

    # Update the remote URL to use the token
    git remote remove origin
    git remote add origin "https://$PAT_TOKEN@github.com/lucuberatur/automatus-vscode.git"

    echo "✅ Personal Access Token configured!"

elif [[ "$AUTH_OPTION" == "B" || "$AUTH_OPTION" == "b" ]]; then
    echo ""
    echo "🔧 Installing GitHub CLI..."

    if command -v brew >/dev/null 2>&1; then
        brew install gh
        echo "✅ GitHub CLI installed!"
        echo ""
        echo "🔐 Now authenticate with GitHub:"
        gh auth login
    else
        echo "❌ Homebrew not found. Please install it first:"
        echo "   /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        exit 1
    fi

elif [[ "$AUTH_OPTION" == "C" || "$AUTH_OPTION" == "c" ]]; then
    echo ""
    echo "🔑 Setting up SSH..."
    echo "📱 Please:"
    echo "  1. Generate SSH key: ssh-keygen -t ed25519 -C 'your_email@example.com'"
    echo "  2. Add to ssh-agent: ssh-add ~/.ssh/id_ed25519"
    echo "  3. Copy public key: cat ~/.ssh/id_ed25519.pub"
    echo "  4. Go to: https://github.com/settings/keys"
    echo "  5. Click 'New SSH key' and paste the public key"
    echo ""
    read -p "❓ Have you set up SSH keys? (y/n): " SSH_READY

    if [[ "$SSH_READY" == "y" || "$SSH_READY" == "Y" ]]; then
        # Update remote to use SSH
        git remote remove origin
        git remote add origin "git@github.com:lucuberatur/automatus-vscode.git"
        echo "✅ SSH configured!"
    else
        echo "⏸️  Please set up SSH keys first, then run this script again."
        exit 0
    fi
else
    echo "❌ Invalid option. Please choose A, B, or C."
    exit 1
fi

echo ""
echo "📦 Step 2: Sync with GitHub repository"
echo ""

# Pull any changes from GitHub first
echo "🔄 Pulling changes from GitHub..."
if git pull origin main --allow-unrelated-histories; then
    echo "✅ Successfully synced with GitHub!"
else
    echo "⚠️  Pull had conflicts. Let's resolve them..."

    # Check if there are merge conflicts
    if git status | grep -q "both modified\|both added"; then
        echo ""
        echo "🔧 Merge conflicts detected. Common files:"
        echo "  - README.md (GitHub's vs yours)"
        echo "  - .gitignore (GitHub's vs yours)"
        echo ""
        echo "🎯 Quick resolution options:"
        echo "  1. Keep your files (recommended)"
        echo "  2. Keep GitHub's files"
        echo "  3. Manually resolve conflicts"

        read -p "❓ What would you like to do? (1/2/3): " RESOLVE_OPTION

        if [[ "$RESOLVE_OPTION" == "1" ]]; then
            # Keep local files
            git checkout --ours .
            git add .
            git commit -m "Resolve merge conflicts: keep local files"
            echo "✅ Kept your local files"

        elif [[ "$RESOLVE_OPTION" == "2" ]]; then
            # Keep GitHub files
            git checkout --theirs .
            git add .
            git commit -m "Resolve merge conflicts: keep GitHub files"
            echo "✅ Kept GitHub's files"

        else
            echo "⏸️  Please resolve conflicts manually:"
            echo "  1. Edit conflicted files"
            echo "  2. Run: git add ."
            echo "  3. Run: git commit -m 'Resolve merge conflicts'"
            echo "  4. Run: git push origin main"
            exit 0
        fi
    fi
fi

echo ""
echo "🚀 Step 3: Push to GitHub"

# Now try to push
echo "📤 Pushing to GitHub..."
if git push origin main; then
    echo ""
    echo "🎉 SUCCESS! Your code is now on GitHub with GitHub Actions!"
    echo ""
    echo "🔍 Next Steps:"
    echo "  1. Go to: https://github.com/lucuberatur/automatus-vscode"
    echo "  2. Click the 'Actions' tab"
    echo "  3. Watch your workflows run!"
    echo ""
    echo "📊 Your GitHub Actions are now active:"
    echo "  ✅ CI/CD Pipeline"
    echo "  ✅ Type Safety Monitor"
    echo "  ✅ Pre-commit Checks"
    echo "  ✅ Performance Testing"
    echo "  ✅ Health Dashboard"
    echo ""
    echo "🎯 Repository: https://github.com/lucuberatur/automatus-vscode"
    echo "🎯 Actions: https://github.com/lucuberatur/automatus-vscode/actions"

else
    echo ""
    echo "❌ Push still failed. Let's debug..."
    echo ""
    echo "🔍 Checking authentication:"
    git remote -v
    echo ""
    echo "🔍 Checking repository access:"
    echo "  Try visiting: https://github.com/lucuberatur/automatus-vscode"
    echo "  Make sure it's public and you have access"
    echo ""
    echo "🔧 Manual steps to try:"
    echo "  1. Verify your PAT token has 'repo' scope"
    echo "  2. Try: git push -v origin main (verbose output)"
    echo "  3. Check if 2FA is enabled on your GitHub account"
fi