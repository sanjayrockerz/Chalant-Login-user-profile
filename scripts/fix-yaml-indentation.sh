#!/bin/bash

# YAML Indentation Fixer
# Normalizes indentation in GitHub Actions workflow files

set -e

echo "🔧 Fixing YAML Indentation Issues"
echo "================================="
echo ""

workflows=(
    ".github/workflows/signup-service.yml"
    ".github/workflows/login-service.yml"
    ".github/workflows/shared-ci.yml"
    ".github/workflows/deployment.yml"
    ".github/workflows/security.yml"
    ".github/workflows/metrics.yml"
)

for workflow in "${workflows[@]}"; do
    if [[ -f "$workflow" ]]; then
        echo "Processing $(basename "$workflow")..."
        
        # Create backup
        cp "$workflow" "$workflow.backup"
        
        # Fix common indentation issues:
        # 1. Convert tabs to spaces
        # 2. Ensure consistent 2-space indentation for YAML
        # 3. Fix any trailing whitespace
        
        # Convert tabs to 2 spaces and remove trailing whitespace
        sed -i '' 's/\t/  /g; s/[[:space:]]*$//' "$workflow"
        
        # Check if the file was modified
        if ! diff -q "$workflow" "$workflow.backup" >/dev/null 2>&1; then
            echo "   ✅ Fixed indentation issues"
        else
            echo "   ➖ No changes needed"
        fi
        
        # Remove backup if no changes
        if diff -q "$workflow" "$workflow.backup" >/dev/null 2>&1; then
            rm "$workflow.backup"
        else
            echo "   📁 Backup saved as $workflow.backup"
        fi
    else
        echo "   ❌ $workflow not found"
    fi
done

echo ""
echo "✅ YAML indentation normalization complete!"
echo ""

# Quick validation check
echo "🔍 Quick validation check..."
for workflow in "${workflows[@]}"; do
    if [[ -f "$workflow" ]]; then
        # Check for basic YAML structure
        if grep -q "^name:" "$workflow" && grep -q "^on:" "$workflow" && grep -q "^jobs:" "$workflow"; then
            echo "✅ $(basename "$workflow"): Basic structure intact"
        else
            echo "❌ $(basename "$workflow"): Basic structure issues detected"
        fi
    fi
done

echo ""
echo "🎯 Indentation fix complete! Re-run validation script to verify."