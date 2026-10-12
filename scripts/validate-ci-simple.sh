#!/bin/bash

# Simple CI/CD Workflow Validation Script
# Uses basic checks for YAML structure without requiring Python libraries

set -e

echo "🚀 CI/CD Workflow Validation (Simple)"
echo "====================================="
echo ""

# Check if we're in the right directory
if [[ ! -d ".github/workflows" || ! -d "services" ]]; then
    echo "❌ Error: Please run this script from the monorepo root directory"
    exit 1
fi

echo "📋 Starting workflow validation..."
echo ""

# 1. Basic YAML Structure Check
echo "1️⃣ Basic YAML Structure Check"
echo "-----------------------------"

workflows=(
    ".github/workflows/signup-service.yml"
    ".github/workflows/login-service.yml"
    ".github/workflows/shared-ci.yml"
    ".github/workflows/deployment.yml"
    ".github/workflows/security.yml"
    ".github/workflows/metrics.yml"
)

yaml_issues=0
for workflow in "${workflows[@]}"; do
    if [[ -f "$workflow" ]]; then
        echo "Checking $(basename "$workflow")..."
        
        # Basic YAML structure checks
        issues=0
        
        # Check for basic YAML structure
        if ! grep -q "^name:" "$workflow"; then
            echo "   ⚠️ Missing 'name:' field"
            issues=$((issues + 1))
        fi
        
        if ! grep -q "^on:" "$workflow"; then
            echo "   ⚠️ Missing 'on:' field"
            issues=$((issues + 1))
        fi
        
        if ! grep -q "^jobs:" "$workflow"; then
            echo "   ⚠️ Missing 'jobs:' field"
            issues=$((issues + 1))
        fi
        
        # Check for proper indentation (basic check)
        if grep -q "^[[:space:]]*[[:space:]][[:space:]][[:space:]][[:space:]]" "$workflow"; then
            # Check if indentation is consistent (2 or 4 spaces)
            if grep -q "^[[:space:]]*[[:space:]][[:space:]][[:space:]][[:space:]][[:space:]]" "$workflow"; then
                echo "   ⚠️ Inconsistent indentation detected"
                issues=$((issues + 1))
            fi
        fi
        
        # Check for common YAML syntax issues
        if grep -q ": \${{" "$workflow" && ! grep -q ": \${{ " "$workflow"; then
            echo "   ⚠️ Potential expression syntax issue"
            issues=$((issues + 1))
        fi
        
        # Check for unclosed brackets
        open_brackets=$(grep -o '\${{' "$workflow" | wc -l)
        close_brackets=$(grep -o '}}' "$workflow" | wc -l)
        if [[ $open_brackets -ne $close_brackets ]]; then
            echo "   ⚠️ Mismatched expression brackets: $open_brackets open, $close_brackets close"
            issues=$((issues + 1))
        fi
        
        if [[ $issues -eq 0 ]]; then
            echo "   ✅ $workflow basic structure OK"
        else
            echo "   ⚠️ $workflow has $issues potential issues"
            yaml_issues=$((yaml_issues + issues))
        fi
    else
        echo "   ❌ $workflow not found"
        yaml_issues=$((yaml_issues + 1))
    fi
done

if [[ $yaml_issues -eq 0 ]]; then
    echo "✅ All YAML files have basic valid structure"
else
    echo "⚠️ Found $yaml_issues potential YAML issues"
fi
echo ""

# 2. GitHub Actions Workflow Validation
echo "2️⃣ GitHub Actions Workflow Requirements"
echo "--------------------------------------"

for workflow in "${workflows[@]}"; do
    if [[ -f "$workflow" ]]; then
        workflow_name=$(basename "$workflow" .yml)
        echo "Checking $workflow_name requirements..."
        
        # Check for GitHub Actions runner
        if grep -q "runs-on:" "$workflow"; then
            echo "   ✅ Has runner configuration"
        else
            echo "   ❌ Missing runner configuration"
        fi
        
        # Check for steps
        if grep -q "steps:" "$workflow"; then
            echo "   ✅ Has steps defined"
        else
            echo "   ❌ Missing steps"
        fi
        
        # Check for actions usage
        if grep -q "uses:" "$workflow"; then
            echo "   ✅ Uses GitHub Actions"
        else
            echo "   ➖ No external actions used"
        fi
        
        # Check for conditionals
        if grep -q "if:" "$workflow"; then
            echo "   ✅ Has conditional logic"
        else
            echo "   ➖ No conditional logic"
        fi
        
        echo ""
    fi
done

# 3. Path Filter Validation
echo "3️⃣ Path Filter Implementation"
echo "-----------------------------"

# Check if dorny/paths-filter is used
path_filter_count=0
for workflow in "${workflows[@]}"; do
    if [[ -f "$workflow" ]] && grep -q "dorny/paths-filter" "$workflow"; then
        path_filter_count=$((path_filter_count + 1))
    fi
done

echo "📊 Workflows using path filters: $path_filter_count/${#workflows[@]}"

if [[ $path_filter_count -ge 2 ]]; then
    echo "✅ Path filtering implemented"
else
    echo "⚠️ Limited path filtering implementation"
fi

# Check path filter patterns
echo ""
echo "Checking path filter patterns..."

service_workflows=(".github/workflows/signup-service.yml" ".github/workflows/login-service.yml")
for workflow in "${service_workflows[@]}"; do
    if [[ -f "$workflow" ]]; then
        workflow_name=$(basename "$workflow" .yml)
        
        if grep -q "services/" "$workflow"; then
            echo "✅ $workflow_name: includes service paths"
        else
            echo "⚠️ $workflow_name: missing service paths"
        fi
        
        if grep -q "src/" "$workflow"; then
            echo "✅ $workflow_name: includes shared src paths"
        else
            echo "⚠️ $workflow_name: missing shared src paths"
        fi
    fi
done

echo ""

# 4. Performance Optimization Check
echo "4️⃣ Performance Optimizations"
echo "----------------------------"

echo "Checking optimization features..."

# Caching
cache_count=0
for workflow in "${workflows[@]}"; do
    if [[ -f "$workflow" ]] && grep -q "actions/cache" "$workflow"; then
        cache_count=$((cache_count + 1))
    fi
done
echo "📊 Workflows with caching: $cache_count/${#workflows[@]}"

# Matrix builds
matrix_count=0
for workflow in "${workflows[@]}"; do
    if [[ -f "$workflow" ]] && grep -q "strategy:" "$workflow"; then
        matrix_count=$((matrix_count + 1))
    fi
done
echo "📊 Workflows with matrix builds: $matrix_count/${#workflows[@]}"

# Parallel jobs
parallel_count=0
for workflow in "${workflows[@]}"; do
    if [[ -f "$workflow" ]] && grep -q "needs:" "$workflow"; then
        parallel_count=$((parallel_count + 1))
    fi
done
echo "📊 Workflows with job dependencies: $parallel_count/${#workflows[@]}"

# Timeouts
timeout_count=0
for workflow in "${workflows[@]}"; do
    if [[ -f "$workflow" ]] && grep -q "timeout-minutes:" "$workflow"; then
        timeout_count=$((timeout_count + 1))
    fi
done
echo "📊 Workflows with timeouts: $timeout_count/${#workflows[@]}"

echo ""

# 5. Service Integration Check
echo "5️⃣ Service Integration"
echo "----------------------"

echo "Checking service configurations..."

# Check service directories
services=("personal-email-signup-backend" "login-page-back")
for service in "${services[@]}"; do
    service_path="services/$service"
    if [[ -d "$service_path" ]]; then
        echo "✅ Service exists: $service"
        
        # Check for build configuration
        build_configs=0
        
        if [[ -f "$service_path/package.json" ]]; then
            build_configs=$((build_configs + 1))
            echo "   ✅ package.json configuration"
        fi
        
        if [[ -f "$service_path/Dockerfile" ]]; then
            build_configs=$((build_configs + 1))
            echo "   ✅ Docker configuration"
        fi
        
        if [[ -f "$service_path/Makefile" ]]; then
            build_configs=$((build_configs + 1))
            echo "   ✅ Make configuration"
        fi
        
        if [[ $build_configs -eq 0 ]]; then
            echo "   ⚠️ No standard build configuration found"
        fi
    else
        echo "❌ Service missing: $service"
    fi
done

echo ""

# 6. Security Features Check
echo "6️⃣ Security Features"
echo "--------------------"

echo "Checking security implementations..."

# Check for security workflow
if [[ -f ".github/workflows/security.yml" ]]; then
    echo "✅ Dedicated security workflow exists"
    
    # Check for security scans
    security_features=0
    
    if grep -q "npm audit\|yarn audit" ".github/workflows/security.yml"; then
        echo "   ✅ Dependency vulnerability scanning"
        security_features=$((security_features + 1))
    fi
    
    if grep -q "secrets\|secret" ".github/workflows/security.yml"; then
        echo "   ✅ Secret scanning"
        security_features=$((security_features + 1))
    fi
    
    if grep -q "codeql\|CodeQL" ".github/workflows/security.yml"; then
        echo "   ✅ Static analysis (CodeQL)"
        security_features=$((security_features + 1))
    fi
    
    if grep -q "docker.*scan\|trivy\|snyk" ".github/workflows/security.yml"; then
        echo "   ✅ Container scanning"
        security_features=$((security_features + 1))
    fi
    
    echo "   📊 Security features implemented: $security_features/4"
else
    echo "⚠️ No dedicated security workflow"
fi

# Check for CODEOWNERS
if [[ -f ".github/CODEOWNERS" ]]; then
    echo "✅ CODEOWNERS file exists"
else
    echo "⚠️ CODEOWNERS file missing"
fi

echo ""

# 7. Documentation Check
echo "7️⃣ Documentation"
echo "----------------"

echo "Checking documentation completeness..."

docs_score=0
total_docs=4

required_docs=(
    "docs/CI.md"
    "docs/CI_ARCHITECTURE_DESIGN.md"
    "docs/SYNC_IMPLEMENTATION_SUMMARY.md"
    "SYNC.md"
)

for doc in "${required_docs[@]}"; do
    if [[ -f "$doc" ]]; then
        echo "✅ $doc exists"
        docs_score=$((docs_score + 1))
    else
        echo "❌ $doc missing"
    fi
done

echo "📊 Documentation completeness: $docs_score/$total_docs"

echo ""

# 8. Final Assessment
echo "8️⃣ Final Assessment"
echo "==================="

# Calculate overall score
category_scores=(
    $([[ $yaml_issues -eq 0 ]] && echo 1 || echo 0)  # YAML structure
    $([[ $path_filter_count -ge 2 ]] && echo 1 || echo 0)  # Path filtering
    $([[ $cache_count -ge 2 ]] && echo 1 || echo 0)  # Performance
    $([[ -f ".github/workflows/security.yml" ]] && echo 1 || echo 0)  # Security
    $([[ $docs_score -ge 3 ]] && echo 1 || echo 0)  # Documentation
    $([[ -d "services/personal-email-signup-backend" && -d "services/login-page-back" ]] && echo 1 || echo 0)  # Services
)

total_score=0
for score in "${category_scores[@]}"; do
    total_score=$((total_score + score))
done

total_categories=${#category_scores[@]}
percentage=$((total_score * 100 / total_categories))

echo "📊 Overall Assessment:"
echo "   📝 YAML Structure: $([[ ${category_scores[0]} -eq 1 ]] && echo "✅ PASS" || echo "❌ FAIL")"
echo "   🎯 Path Filtering: $([[ ${category_scores[1]} -eq 1 ]] && echo "✅ PASS" || echo "❌ FAIL")"
echo "   ⚡ Performance: $([[ ${category_scores[2]} -eq 1 ]] && echo "✅ PASS" || echo "❌ FAIL")"
echo "   🔒 Security: $([[ ${category_scores[3]} -eq 1 ]] && echo "✅ PASS" || echo "❌ FAIL")"
echo "   📚 Documentation: $([[ ${category_scores[4]} -eq 1 ]] && echo "✅ PASS" || echo "❌ FAIL")"
echo "   🏗️ Services: $([[ ${category_scores[5]} -eq 1 ]] && echo "✅ PASS" || echo "❌ FAIL")"

echo ""
echo "🎯 **Overall Score: $total_score/$total_categories ($percentage%)**"

if [[ $percentage -ge 90 ]]; then
    echo "🎉 **Status: EXCELLENT** - Production ready!"
    exit_code=0
elif [[ $percentage -ge 75 ]]; then
    echo "👍 **Status: GOOD** - Minor improvements recommended"
    exit_code=0
elif [[ $percentage -ge 60 ]]; then
    echo "⚠️ **Status: ACCEPTABLE** - Some improvements needed"
    exit_code=1
else
    echo "❌ **Status: NEEDS WORK** - Significant improvements required"
    exit_code=1
fi

echo ""
echo "🚀 **Next Steps:**"
echo "1. Address any failed categories above"
echo "2. Test workflows with real commits"
echo "3. Monitor performance in practice"
echo "4. Iterate based on team feedback"

if [[ $percentage -ge 75 ]]; then
    echo ""
    echo "✅ **Ready for initial deployment and testing!**"
fi

exit $exit_code