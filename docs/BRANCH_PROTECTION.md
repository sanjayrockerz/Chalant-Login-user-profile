# Branch Protection Rules Configuration

This document provides the exact branch protection rules that must be configured in the GitHub repository settings to enforce governance policies.

## Configuration Instructions

1. Navigate to **Settings** → **Branches** in the GitHub repository
2. Click **Add rule** for each rule below
3. Apply the exact configurations specified

---

## 1. Main Branch Protection

### Branch Name Pattern
```
main
```

### Protection Settings

#### Restrict pushes that create files
- ☑️ **Require a pull request before merging**
  - ☑️ **Require approvals**: `2`
  - ☑️ **Dismiss stale reviews when new commits are pushed**
  - ☑️ **Require review from CODEOWNERS**
  - ☑️ **Restrict pushes that create files**
  - ☑️ **Require approval of the most recent reviewable push**

#### Status Checks
- ☑️ **Require status checks to pass before merging**
  - ☑️ **Require branches to be up to date before merging**
  - **Required status checks:**
    ```
    lint
    unit-tests
    integration-tests
    e2e-smoke
    codecov
    trivy-scan
    iac-validate
    ```

#### Additional Restrictions
- ☑️ **Restrict pushes that create files** (prevents accidental large file commits)
- ☑️ **Require signed commits**
- ☑️ **Require linear history** (optional - enables clean git history)
- ☑️ **Require conversation resolution before merging**

#### Administrative Settings
- ☑️ **Include administrators** (applies rules to repo admins)
- ☑️ **Allow force pushes**: `Specify who can force push` → Select: `Deploy keys and service accounts`
- ☑️ **Allow deletions**: `❌ Disabled`

---

## 2. Develop Branch Protection

### Branch Name Pattern
```
develop
```

### Protection Settings

#### Pull Request Requirements
- ☑️ **Require a pull request before merging**
  - ☑️ **Require approvals**: `1`
  - ☑️ **Dismiss stale reviews when new commits are pushed**
  - ☑️ **Require review from CODEOWNERS** (for shared components only)

#### Status Checks
- ☑️ **Require status checks to pass before merging**
  - ☑️ **Require branches to be up to date before merging**
  - **Required status checks:**
    ```
    lint
    unit-tests
    ```

#### Additional Restrictions
- ☑️ **Require conversation resolution before merging**
- ☑️ **Include administrators**

---

## 3. Release Branch Protection

### Branch Name Pattern
```
release/*
```

### Protection Settings

#### Pull Request Requirements
- ☑️ **Require a pull request before merging**
  - ☑️ **Require approvals**: `1`
  - ☑️ **Require review from CODEOWNERS** (domain maintainer)
  - ☑️ **Require approval of the most recent reviewable push**

#### Status Checks
- ☑️ **Require status checks to pass before merging**
  - **Required status checks:**
    ```
    lint
    unit-tests
    integration-tests
    code-sign
    ```

#### Additional Restrictions
- ☑️ **Require signed commits**
- ☑️ **Include administrators**
- ☑️ **Automatically delete head branches** (GitHub setting)

#### Release Requirements
- Releases must originate from an up-to-date `main`
- Change record (IC ticket) linked in PR description
- Compliance verification comment from `@org/security-guild`
- Staging verification checklist completed and attached

---

## 4. Collaboration Branch Guidance

### Branch Name Pattern
```
feature/*
bugfix/*
hotfix/*
chore/*
```

### Expectations

- No enforced protections to keep iteration fast.
- Teams must keep branches current with `main` before opening PRs.
- Enable branch auto-delete on merge and prefer squash merges to reduce noise.
- Hotfix branches must reference the incident ticket and follow the emergency process in `docs/GOVERNANCE.md`.

---

## 5. Security and Infrastructure Branches

### Branch Name Pattern
```
security/*
infra/*
devops/*
```

### Protection Settings

#### Enhanced Security
- ☑️ **Require a pull request before merging**
  - ☑️ **Require approvals**: `2`
  - ☑️ **Require review from CODEOWNERS**
  - ☑️ **Restrict pushes that create files**

#### Required Teams
- Must include approval from: `@org/security-guild`
- Must include approval from: `@org/devops-infra`

---

## Repository-Level Settings

### General Settings

Navigate to **Settings** → **General**

#### Features
- ☑️ **Wikis**: `Disabled` (use docs/ instead)
- ☑️ **Issues**: `Enabled`
- ☑️ **Sponsorship**: `Disabled`
- ☑️ **Projects**: `Enabled`
- ☑️ **Preserve this repository**: `Enabled`

#### Pull Requests
- ☑️ **Allow merge commits**: `Disabled`
- ☑️ **Allow squash merging**: `Enabled`
  - **Default commit message**: `Pull request title and description`
- ☑️ **Allow rebase merging**: `Enabled`
- ☑️ **Always suggest updating pull request branches**: `Enabled`
- ☑️ **Allow auto-merge**: `Enabled`
- ☑️ **Automatically delete head branches**: `Enabled`

#### Pushes
- ☑️ **Limit pushes that create files**: `Enabled`

### Security Settings

Navigate to **Settings** → **Security & analysis**

#### Security Features
- ☑️ **Dependency graph**: `Enabled`
- ☑️ **Dependabot alerts**: `Enabled`
- ☑️ **Dependabot security updates**: `Enabled`
- ☑️ **Dependabot version updates**: `Enabled`
- ☑️ **Code scanning**: `Enabled`
- ☑️ **Secret scanning**: `Enabled`
- ☑️ **Secret scanning push protection**: `Enabled`

#### Private vulnerability reporting
- ☑️ **Enable private vulnerability reporting**: `Enabled`

---

## Webhook Configuration

### Required Webhooks

Navigate to **Settings** → **Webhooks**

#### Slack Integration
```
Payload URL: https://hooks.slack.com/workflows/YOUR_WEBHOOK_URL
Content type: application/json
Events: 
  - Pull requests
  - Pull request reviews
  - Push
  - Issues
  - Security advisory
```

#### Security Monitoring
```
Payload URL: https://security-monitor.company.com/github-webhook
Content type: application/json  
Events:
  - Security advisory
  - Dependabot alerts
  - Code scanning alerts
  - Secret scanning alerts
```

---

## Automated Setup Script

For repository administrators, here's a script to validate the configuration:

```bash
#!/bin/bash
# Branch Protection Validation Script

REPO="org/auth-services-monorepo"

# Check main branch protection
echo "Checking main branch protection..."
gh api repos/$REPO/branches/main/protection --jq '.required_status_checks.contexts[]'

# Check required teams in CODEOWNERS
echo "Validating CODEOWNERS teams..."
grep -E "@org/" .github/CODEOWNERS

# Verify webhook configuration
echo "Checking webhook configuration..."
gh api repos/$REPO/hooks --jq '.[].config.url'

echo "✅ Branch protection validation complete"
```

---

## Testing Branch Protection

### Test Checklist

1. **Direct push to main** → Should be blocked
2. **PR without reviews** → Should be blocked  
3. **PR without CI passing** → Should be blocked
4. **PR without CODEOWNER approval** → Should be blocked
5. **Force push to main** → Should be blocked
6. **Tag creation by non-admin** → Should be blocked
7. **Large file commit** → Should be blocked
8. **Unsigned commit** → Should be blocked

### Test Script

```bash
#!/bin/bash
# Test branch protection rules

# Test 1: Try direct push to main (should fail)
git checkout main
echo "test" > test-file.txt
git add test-file.txt
git commit -m "Test direct push to main"
git push origin main 2>&1 | grep -q "remote rejected" && echo "✅ Direct push blocked" || echo "❌ Direct push allowed"

# Test 2: Create PR without required status checks
git checkout -b test-branch
echo "test change" > README.md
git add README.md
git commit -m "Test PR without CI"
git push origin test-branch
gh pr create --title "Test PR" --body "Testing branch protection"

echo "Check GitHub UI to verify PR cannot be merged without status checks"
```

---

## Troubleshooting

### Common Issues

1. **Status checks not appearing**
   - Verify CI workflow names match exactly
   - Check workflow triggers include pull_request events
   - Ensure workflows have proper permissions

2. **CODEOWNERS not working**
   - Verify team names match exactly (case-sensitive)
   - Check file is named exactly `.github/CODEOWNERS`
   - Ensure teams have repository access

3. **Admins bypassing rules**
   - Ensure "Include administrators" is checked
   - Verify admin users understand governance policies

### Emergency Procedures

If branch protection rules prevent critical hotfixes:

1. **Temporary disable** (admin only):
   ```bash
   # Disable protection temporarily
   gh api -X DELETE repos/bigdaddyhara/auth-services-monorepo/branches/main/protection
   
   # Apply critical fix
   git push origin main
   
   # Re-enable protection
   # (Re-apply rules via GitHub UI)
   ```

2. **Emergency contacts**:
  - Platform Ops: platform-ops@company.com
  - Security Desk: security-incident@company.com
  - Duty Manager: edm@company.com

---

**Document Version**: 2.0  
**Last Updated**: 7 February 2026  
**Next Review**: 7 May 2026  
**Owner**: @org/devops-infra