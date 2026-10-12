#!/bin/bash

# Monorepo Upstream Sync - System Validation Script
# Tests all components of the sync workflow to ensure proper operation

set -e

echo "🚀 Monorepo Upstream Sync - System Validation"
echo "=============================================="
echo ""

# Check if we're in the right directory
if [[ ! -d "services" || ! -d ".git" ]]; then
    echo "❌ Error: Please run this script from the monorepo root directory"
    exit 1
fi

echo "📋 Validating system components..."
echo ""

# 1. Check documentation exists
echo "1️⃣ Documentation Check"
docs=(
    "SYNC.md"
    "docs/SYNC_IMPLEMENTATION_SUMMARY.md"
    "policies/upstream-sync-policy.md"
)

for doc in "${docs[@]}"; do
    if [[ -f "$doc" ]]; then
        echo "   ✅ $doc exists"
    else
        echo "   ❌ $doc missing"
        exit 1
    fi
done
echo ""

# 2. Check automation scripts
echo "2️⃣ Automation Scripts Check"
if [[ -x "scripts/sync-upstream.sh" ]]; then
    echo "   ✅ sync-upstream.sh is executable"
else
    echo "   ❌ sync-upstream.sh not found or not executable"
    exit 1
fi
echo ""

# 3. Check GitHub Actions workflow
echo "3️⃣ GitHub Actions Workflow Check"
if [[ -f ".github/workflows/upstream-sync.yml" ]]; then
    echo "   ✅ upstream-sync.yml workflow exists"
else
    echo "   ❌ upstream-sync.yml workflow missing"
    exit 1
fi
echo ""

# 4. Check git remotes
echo "4️⃣ Git Remotes Configuration Check"
required_remotes=("upstream-login" "upstream-signup")
for remote in "${required_remotes[@]}"; do
    if git remote | grep -q "^${remote}$"; then
        url=$(git remote get-url "$remote")
        echo "   ✅ $remote -> $url"
    else
        echo "   ❌ Remote '$remote' not configured"
        exit 1
    fi
done
echo ""

# 5. Test sync script dry-run
echo "5️⃣ Sync Script Functionality Test"
echo "   Running dry-run test..."
# Temporarily stash any uncommitted changes for the test
if [[ -n "$(git status --porcelain)" ]]; then
    echo "   📝 Temporarily stashing uncommitted changes..."
    git stash push -u -m "Temporary stash for validation test" > /dev/null 2>&1
    stashed=true
else
    stashed=false
fi

if ./scripts/sync-upstream.sh --dry-run > /dev/null 2>&1; then
    echo "   ✅ Sync script dry-run successful"
    sync_success=true
else
    echo "   ❌ Sync script dry-run failed"
    sync_success=false
fi

# Restore stashed changes if we stashed them
if [[ "$stashed" == "true" ]]; then
    echo "   📝 Restoring stashed changes..."
    git stash pop > /dev/null 2>&1
fi

if [[ "$sync_success" != "true" ]]; then
    exit 1
fi
echo ""

# 6. Check subtree prefixes exist
echo "6️⃣ Subtree Structure Validation"
subtree_dirs=("services/login-page-back" "services/personal-email-signup-backend")
for dir in "${subtree_dirs[@]}"; do
    if [[ -d "$dir" ]]; then
        echo "   ✅ $dir directory exists"
    else
        echo "   ❌ $dir directory missing"
        exit 1
    fi
done
echo ""

# 7. Test basic git functionality
echo "7️⃣ Git Repository Health Check"
if git status > /dev/null 2>&1; then
    echo "   ✅ Git repository is healthy"
else
    echo "   ❌ Git repository has issues"
    exit 1
fi

# Check if we can fetch from upstreams
if git fetch upstream-login > /dev/null 2>&1 && git fetch upstream-signup > /dev/null 2>&1; then
    echo "   ✅ Can fetch from upstream repositories"
else
    echo "   ❌ Cannot fetch from upstream repositories"
    exit 1
fi
echo ""

# 8. Display system status
echo "8️⃣ System Status Summary"
echo "   📊 Repository: $(basename "$(pwd)")"
echo "   🌿 Current branch: $(git branch --show-current)"
echo "   📝 Last commit: $(git log -1 --oneline)"
echo "   🔗 Configured remotes: $(git remote | wc -l | tr -d ' ')"
echo "   📁 Service directories: $(find services -maxdepth 1 -type d | wc -l | tr -d ' ')"
echo ""

echo "✅ ALL VALIDATION CHECKS PASSED!"
echo ""
echo "🎉 Monorepo upstream sync system is fully operational!"
echo ""
echo "📚 Quick Reference:"
echo "   • Manual sync: ./scripts/sync-upstream.sh"
echo "   • Dry-run test: ./scripts/sync-upstream.sh --dry-run"
echo "   • Documentation: See SYNC.md"
echo "   • Policies: See policies/upstream-sync-policy.md"
echo "   • Auto-sync: GitHub Actions runs weekly"
echo ""
echo "🚀 Ready for production use!"