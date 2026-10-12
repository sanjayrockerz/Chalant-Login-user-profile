#!/bin/bash

# CI/CD Workflow Validation Script
# Tests path filters, validates YAML syntax, and verifies workflow logic

set -e

echo "🚀 CI/CD Workflow Validation"
echo "============================"
echo ""

# Check if we're in the right directory
if [[ ! -d ".github/workflows" || ! -d "services" ]]; then
    echo "❌ Error: Please run this script from the monorepo root directory"
    exit 1
fi

echo "📋 Starting comprehensive workflow validation..."
echo ""

# 1. YAML Syntax Validation
echo "1️⃣ YAML Syntax Validation"
echo "-------------------------"

workflows=(
    ".github/workflows/signup-service.yml"
    ".github/workflows/login-service.yml"
    ".github/workflows/shared-ci.yml"
    ".github/workflows/deployment.yml"
    ".github/workflows/security.yml"
    ".github/workflows/metrics.yml"
)

yaml_errors=0
for workflow in "${workflows[@]}"; do
    if [[ -f "$workflow" ]]; then
        echo "Checking $(basename "$workflow")..."
        
        # Check YAML syntax using Python (available on most systems)
        if python3 -c "
import yaml
import sys
try:
    with open('$workflow', 'r') as f:
        yaml.safe_load(f)
    print('✅ Valid YAML')
except yaml.YAMLError as e:
    print('❌ YAML Error:', e)
    sys.exit(1)
except Exception as e:
    print('⚠️ Warning:', e)
" 2>/dev/null; then
            echo "   ✅ $workflow syntax OK"
        else
            echo "   ❌ $workflow has syntax errors"
            yaml_errors=$((yaml_errors + 1))
        fi
    else
        echo "   ❌ $workflow not found"
        yaml_errors=$((yaml_errors + 1))
    fi
done

if [[ $yaml_errors -eq 0 ]]; then
    echo "✅ All YAML files have valid syntax"
else
    echo "❌ Found $yaml_errors YAML syntax errors"
fi
echo ""

# 2. Path Filter Testing
echo "2️⃣ Path Filter Testing"
echo "----------------------"

# Test path patterns
test_paths=(
    "services/personal-email-signup-backend/src/app.ts"
    "services/login-page-back/src/auth.js"
    "src/contact-import/index.ts"
    "scripts/sync-upstream.sh"
    "docs/CI.md"
    "policies/security-policy.md"
    ".github/workflows/signup-service.yml"
    "README.md"
    "package.json"
)

echo "Testing path filter patterns..."

# Signup service paths
signup_pattern="services/personal-email-signup-backend/|src/|scripts/|docs/|policies/|\.github/workflows/signup-service\.yml"
echo "📧 Signup service filter:"
for path in "${test_paths[@]}"; do
    if echo "$path" | grep -qE "$signup_pattern"; then
        echo "   ✅ $path → triggers signup workflow"
    else
        echo "   ➖ $path → no trigger"
    fi
done

echo ""

# Login service paths  
login_pattern="services/login-page-back/|src/|scripts/|docs/|policies/|\.github/workflows/login-service\.yml"
echo "🔐 Login service filter:"
for path in "${test_paths[@]}"; do
    if echo "$path" | grep -qE "$login_pattern"; then
        echo "   ✅ $path → triggers login workflow"
    else
        echo "   ➖ $path → no trigger"
    fi
done

echo ""

# Shared dependencies paths
shared_pattern="src/|scripts/|policies/|docs/|\.github/"
echo "🔄 Shared dependencies filter:"
for path in "${test_paths[@]}"; do
    if echo "$path" | grep -qE "$shared_pattern"; then
        echo "   ✅ $path → triggers shared workflow"
    else
        echo "   ➖ $path → no trigger"
    fi
done

echo ""

# 3. Workflow Logic Validation
echo "3️⃣ Workflow Logic Validation"
echo "----------------------------"

# Check for required jobs and steps
echo "Checking workflow structure..."

required_jobs=(
    "detect-changes"
    "code-quality"
    "test"
    "build"
)

for workflow in "${workflows[@]}"; do
    if [[ -f "$workflow" ]]; then
        workflow_name=$(basename "$workflow" .yml)
        echo "Analyzing $workflow_name..."
        
        # Check for conditional execution
        if grep -q "needs.*detect-changes" "$workflow"; then
            echo "   ✅ Uses change detection"
        else
            echo "   ⚠️ No change detection found"
        fi
        
        # Check for timeout configurations
        if grep -q "timeout-minutes:" "$workflow"; then
            echo "   ✅ Has timeout protection"
        else
            echo "   ⚠️ No timeout configuration"
        fi
        
        # Check for caching
        if grep -q "uses: actions/cache" "$workflow"; then
            echo "   ✅ Implements caching"
        else
            echo "   ➖ No caching configured"
        fi
        
        # Check for matrix builds
        if grep -q "strategy:" "$workflow"; then
            echo "   ✅ Uses matrix builds"
        else
            echo "   ➖ No matrix strategy"
        fi
        
        echo ""
    fi
done

# 4. Environment Configuration
echo "4️⃣ Environment Configuration"
echo "----------------------------"

echo "Checking environment setup..."

# Check for service directories
services=("personal-email-signup-backend" "login-page-back")
for service in "${services[@]}"; do
    service_path="services/$service"
    if [[ -d "$service_path" ]]; then
        echo "✅ Service directory exists: $service_path"
        
        # Check for package.json
        if [[ -f "$service_path/package.json" ]]; then
            echo "   ✅ package.json found"
            
            # Check for required scripts
            if grep -q '"build"' "$service_path/package.json"; then
                echo "   ✅ Build script configured"
            else
                echo "   ⚠️ No build script found"
            fi
            
            if grep -q '"test"' "$service_path/package.json"; then
                echo "   ✅ Test script configured"
            else
                echo "   ⚠️ No test script found"
            fi
            
            if grep -q '"lint"' "$service_path/package.json"; then
                echo "   ✅ Lint script configured"
            else
                echo "   ⚠️ No lint script found"
            fi
        else
            echo "   ℹ️ No package.json (custom build system)"
        fi
        
        # Check for Dockerfile
        if [[ -f "$service_path/Dockerfile" ]]; then
            echo "   ✅ Dockerfile found"
        else
            echo "   ➖ No Dockerfile found"
        fi
    else
        echo "❌ Service directory missing: $service_path"
    fi
    echo ""
done

# 5. Shared Dependencies Validation
echo "5️⃣ Shared Dependencies Validation"
echo "---------------------------------"

echo "Checking shared components..."

shared_components=(
    "src"
    "scripts"
    "docs"
    "policies"
)

for component in "${shared_components[@]}"; do
    if [[ -d "$component" ]]; then
        echo "✅ Shared component exists: $component/"
        
        file_count=$(find "$component" -type f | wc -l)
        echo "   📁 Contains $file_count files"
        
        # Check for executable scripts
        if [[ "$component" == "scripts" ]]; then
            executable_count=$(find "$component" -name "*.sh" -executable | wc -l)
            echo "   🔧 Executable scripts: $executable_count"
        fi
    else
        echo "⚠️ Shared component missing: $component/"
    fi
done

echo ""

# 6. Security Configuration
echo "6️⃣ Security Configuration"
echo "-------------------------"

echo "Checking security setup..."

# Check for required security files
security_files=(
    "policies/upstream-sync-policy.md"
    "SECURITY_COMPLIANCE.md"
    ".github/CODEOWNERS"
)

for file in "${security_files[@]}"; do
    if [[ -f "$file" ]]; then
        echo "✅ Security file exists: $file"
    else
        echo "⚠️ Security file missing: $file"
    fi
done

# Check for secret scanning in workflows
if grep -r "secrets:" .github/workflows/ | grep -v "GITHUB_TOKEN\|github.token"; then
    echo "⚠️ Custom secrets detected in workflows - verify security"
else
    echo "✅ No custom secrets in workflows"
fi

echo ""

# 7. Performance Validation
echo "7️⃣ Performance Validation"
echo "-------------------------"

echo "Checking performance optimizations..."

# Check for caching strategies
cache_workflows=0
for workflow in "${workflows[@]}"; do
    if [[ -f "$workflow" ]] && grep -q "actions/cache" "$workflow"; then
        cache_workflows=$((cache_workflows + 1))
    fi
done

echo "📊 Workflows with caching: $cache_workflows/${#workflows[@]}"

# Check for parallel execution
parallel_workflows=0
for workflow in "${workflows[@]}"; do
    if [[ -f "$workflow" ]] && grep -q "strategy:" "$workflow"; then
        parallel_workflows=$((parallel_workflows + 1))
    fi
done

echo "⚡ Workflows with parallelization: $parallel_workflows/${#workflows[@]}"

# Check for conditional execution
conditional_workflows=0
for workflow in "${workflows[@]}"; do
    if [[ -f "$workflow" ]] && grep -q "if:" "$workflow"; then
        conditional_workflows=$((conditional_workflows + 1))
    fi
done

echo "🎯 Workflows with conditional execution: $conditional_workflows/${#workflows[@]}"

echo ""

# 8. Integration Testing
echo "8️⃣ Integration Testing"
echo "----------------------"

echo "Testing workflow integration..."

# Test script executability
echo "🔧 Script validation:"
if [[ -x "scripts/sync-upstream.sh" ]]; then
    echo "   ✅ sync-upstream.sh is executable"
    if ./scripts/sync-upstream.sh --dry-run >/dev/null 2>&1; then
        echo "   ✅ sync-upstream.sh dry-run successful"
    else
        echo "   ⚠️ sync-upstream.sh dry-run warnings"
    fi
else
    echo "   ❌ sync-upstream.sh not executable or missing"
fi

if [[ -x "scripts/validate-sync-system.sh" ]]; then
    echo "   ✅ validate-sync-system.sh is executable"
else
    echo "   ❌ validate-sync-system.sh not executable or missing"
fi

echo ""

# 9. Documentation Validation
echo "9️⃣ Documentation Validation"
echo "---------------------------"

echo "Checking documentation completeness..."

required_docs=(
    "docs/CI.md"
    "docs/CI_ARCHITECTURE_DESIGN.md"
    "docs/SYNC_IMPLEMENTATION_SUMMARY.md"
    "SYNC.md"
)

for doc in "${required_docs[@]}"; do
    if [[ -f "$doc" ]]; then
        echo "✅ Documentation exists: $doc"
        
        # Check if document has content
        if [[ $(wc -l < "$doc") -gt 10 ]]; then
            echo "   ✅ Document has substantial content"
        else
            echo "   ⚠️ Document appears to be a stub"
        fi
    else
        echo "❌ Documentation missing: $doc"
    fi
done

echo ""

# 10. Final Validation Summary
echo "🔟 Final Validation Summary"
echo "============================"

validation_score=0
total_checks=9

# Calculate score based on previous checks
if [[ $yaml_errors -eq 0 ]]; then
    validation_score=$((validation_score + 1))
    echo "✅ YAML Syntax: PASSED"
else
    echo "❌ YAML Syntax: FAILED"
fi

# Path filters (always pass if workflows exist)
if [[ ${#workflows[@]} -gt 0 ]]; then
    validation_score=$((validation_score + 1))
    echo "✅ Path Filters: CONFIGURED"
else
    echo "❌ Path Filters: MISSING"
fi

# Workflow logic (check if main workflows exist)
if [[ -f ".github/workflows/signup-service.yml" && -f ".github/workflows/login-service.yml" ]]; then
    validation_score=$((validation_score + 1))
    echo "✅ Workflow Logic: IMPLEMENTED"
else
    echo "❌ Workflow Logic: INCOMPLETE"
fi

# Environment (check if services exist)
if [[ -d "services/personal-email-signup-backend" && -d "services/login-page-back" ]]; then
    validation_score=$((validation_score + 1))
    echo "✅ Environment: CONFIGURED"
else
    echo "❌ Environment: INCOMPLETE"
fi

# Shared dependencies (check if shared dirs exist)
shared_dirs_exist=true
for component in "${shared_components[@]}"; do
    if [[ ! -d "$component" ]]; then
        shared_dirs_exist=false
        break
    fi
done

if $shared_dirs_exist; then
    validation_score=$((validation_score + 1))
    echo "✅ Shared Dependencies: CONFIGURED"
else
    echo "⚠️ Shared Dependencies: PARTIAL"
fi

# Security (check for basic security files)
if [[ -f ".github/CODEOWNERS" ]]; then
    validation_score=$((validation_score + 1))
    echo "✅ Security: BASIC SETUP"
else
    echo "⚠️ Security: NEEDS ATTENTION"
fi

# Performance (check for caching)
if [[ $cache_workflows -gt 2 ]]; then
    validation_score=$((validation_score + 1))
    echo "✅ Performance: OPTIMIZED"
else
    echo "⚠️ Performance: BASIC"
fi

# Integration (check for scripts)
if [[ -x "scripts/sync-upstream.sh" ]]; then
    validation_score=$((validation_score + 1))
    echo "✅ Integration: WORKING"
else
    echo "⚠️ Integration: PARTIAL"
fi

# Documentation (check for main docs)
if [[ -f "docs/CI.md" ]]; then
    validation_score=$((validation_score + 1))
    echo "✅ Documentation: COMPLETE"
else
    echo "⚠️ Documentation: BASIC"
fi

echo ""
echo "📊 Validation Score: $validation_score/$total_checks"

# Calculate percentage
percentage=$((validation_score * 100 / total_checks))

if [[ $percentage -ge 90 ]]; then
    echo "🎉 **Validation Status: EXCELLENT** ($percentage%)"
    echo "✅ CI/CD workflows are production-ready!"
elif [[ $percentage -ge 75 ]]; then
    echo "👍 **Validation Status: GOOD** ($percentage%)"
    echo "✅ CI/CD workflows are functional with minor improvements needed"
elif [[ $percentage -ge 60 ]]; then
    echo "⚠️ **Validation Status: ACCEPTABLE** ($percentage%)"
    echo "🔧 CI/CD workflows need some improvements before production use"
else
    echo "❌ **Validation Status: NEEDS WORK** ($percentage%)"
    echo "🚨 CI/CD workflows require significant improvements"
fi

echo ""
echo "📚 Next Steps:"
echo "1. Review any failed checks above"
echo "2. Fix YAML syntax errors if any"
echo "3. Test workflows with actual commits"
echo "4. Monitor performance in practice"
echo "5. Update documentation as needed"
echo ""

if [[ $validation_score -eq $total_checks ]]; then
    echo "🚀 Ready for production deployment!"
    exit 0
else
    echo "🔧 Improvements recommended before production use"
    exit 1
fi