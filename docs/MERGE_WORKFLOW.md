# Merge Workflow and Commit Guidelines

## Overview

This document defines the merge strategies, commit conventions, and workflow guidelines for the `auth-services-monorepo` to maintain clean history, enable efficient collaboration, and support automated tooling.

---

## 🔄 Merge Strategies

### Preferred Merge Strategy by Change Type

#### 1. **Squash and Merge** (Default - Recommended)
**When to use:**
- Feature development
- Bug fixes
- Documentation updates
- Most standard changes

**Benefits:**
- Clean, linear history
- Single commit per feature
- Easy to revert features
- Clear changelog generation

**Configuration:**
```yaml
merge_method: squash
commit_title_template: "{{ title }} (#{{ number }})"
commit_message_template: |
  {{ title }} (#{{ number }})
  
  {{ body }}
  
  Co-authored-by: {{ co_authors }}
```

#### 2. **Rebase and Merge**
**When to use:**
- Small, atomic commits that should be preserved
- Hot fixes that need immediate deployment
- Changes that benefit from detailed commit history

**Requirements:**
- Each commit must be atomic and meaningful
- All commits must pass CI individually
- Commit messages must follow conventional commit format

#### 3. **Merge Commit** (Restricted)
**When to use:**
- Release merges from develop to main
- Large feature branch integration
- When preserving branch context is important

**Requirements:**
- Requires approval from repository maintainer
- Only for significant feature branches
- Must include comprehensive merge commit message

---


## 📝 Conventional Commit Format

### Commit Message Structure

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Commit Types
| Type | Description | Changelog Section |
|------|-------------|------------------|
| `feat` | New feature | Features |
| `fix` | Bug fix | Bug Fixes |
| `docs` | Documentation | Documentation |
| `style` | Code style changes | - |
| `refactor` | Code refactoring | - |
| `perf` | Performance improvements | Performance |
| `test` | Test additions/changes | - |
| `chore` | Maintenance tasks | - |
| `build` | Build system changes | Build System |
| `ci` | CI/CD changes | - |
| `revert` | Reverting changes | Reverts |
| `security` | Security fixes | Security |

### Scopes

| Scope | Description |
|-------|-------------|
| `signup` | Personal email signup backend |
| `login` | Login page backend |
| `auth` | Authentication/authorization |
| `shared` | Shared libraries |
| `scripts` | Build/deployment scripts |
| `docs` | Documentation |
| `ci` | CI/CD workflows |
| `deps` | Dependencies |
| `config` | Configuration files |

### Examples

#### Good Commit Messages
```bash
feat(signup): add OTP verification with Redis caching

- Implement OTP generation using crypto.randomBytes
- Add Redis storage for OTP tokens with TTL
- Include rate limiting for OTP requests
- Add comprehensive unit tests

Closes #123
```

```bash
fix(auth): resolve JWT token expiration handling

- Fix token refresh logic in middleware
- Add proper error responses for expired tokens
- Update authentication tests

Fixes #456
```

```bash
docs(api): update signup endpoint documentation

- Add request/response examples
- Include error code definitions
- Update OpenAPI schema

```

#### Bad Commit Messages
```bash
# Too vague
fix: bug fix

# No scope when needed
feat: add new feature

# Wrong type
feat: fix typo in documentation

# Missing description
fix(auth):
```

---

## 🚀 Workflow Guidelines

### Branch Naming Conventions

#### Feature Branches
```bash
feature/<ticket-id>-<short-description>
feat/<ticket-id>-<short-description>

# Examples:
feature/AUTH-123-oauth-integration
feat/SIGNUP-456-email-verification
```

#### Bug Fix Branches
```bash
bugfix/<ticket-id>-<short-description>
fix/<ticket-id>-<short-description>

# Examples:
bugfix/AUTH-789-token-refresh-issue
fix/SIGNUP-101-validation-error
```

#### Hotfix Branches
```bash
hotfix/<ticket-id>-<short-description>

# Examples:
hotfix/SECURITY-001-xss-vulnerability
hotfix/AUTH-999-login-timeout
```

#### Infrastructure Branches
```bash
infra/<ticket-id>-<short-description>
devops/<ticket-id>-<short-description>

# Examples:
infra/OPS-123-monitoring-setup
devops/CI-456-pipeline-optimization
```

### Pull Request Workflow

#### 1. Pre-Development
```bash
# 1. Create feature branch from main
git checkout main
git pull origin main
git checkout -b feature/AUTH-123-oauth-integration

# 2. Make incremental commits
git add .
git commit -m "feat(auth): add OAuth provider configuration"
```

#### 2. Development Process
```bash
# Keep branch updated with main
git fetch origin
git rebase origin/main

# Push to remote branch
git push origin feature/AUTH-123-oauth-integration

# Create pull request via GitHub CLI or UI
gh pr create --title "feat(auth): implement OAuth integration" \
             --body-file PR_DESCRIPTION.md \
             --reviewer @org/authn-authz
```

#### 3. Review Process
- **Initial Review**: Automated CI/CD checks
- **Code Review**: Required approvals from CODEOWNERS
- **Security Review**: For security-sensitive changes
- **Architecture Review**: For significant design changes

#### 4. Merge Process
```bash
# Once approved, merge via GitHub UI with squash
# Or via CLI:
gh pr merge --squash --delete-branch
```

---

## 🔍 Code Review Guidelines

### Review Checklist

#### For Authors
- [ ] Self-review completed before requesting review
- [ ] All CI checks passing
- [ ] PR description complete with context
- [ ] Breaking changes documented
- [ ] Tests added/updated

#### For Reviewers
- [ ] **Functionality**: Code works as intended
- [ ] **Security**: No security vulnerabilities
- [ ] **Performance**: No performance regressions
- [ ] **Maintainability**: Code is readable and well-structured
- [ ] **Testing**: Adequate test coverage
- [ ] **Documentation**: Changes are documented

### Review Response SLAs

| Priority | Response Time | Review Completion |
|----------|---------------|------------------|
| **Critical/Hotfix** | 2 hours | 4 hours |
| **High** | 8 hours | 1 business day |
| **Medium** | 1 business day | 2 business days |
| **Low** | 2 business days | 3 business days |

### Review Approval Rules

#### Service-Level Changes
- **signup service**: Requires `@org/identity-platform` approval
- **login service**: Requires `@org/session-platform` approval
- **shared components**: Requires approval from all affected teams

#### Special Requirements
- **Security changes**: Requires `@org/security-guild` approval
- **Infrastructure changes**: Requires `@org/devops-infra` approval
- **Database migrations**: Requires senior engineer approval
- **Breaking changes**: Requires maintainer approval

---

## 🏷️ Release and Tagging Strategy

### Version Management

#### Semantic Versioning
```
MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]

Examples:
1.0.0      - Major release
1.1.0      - Minor release with new features
1.1.1      - Patch release with bug fixes
1.2.0-beta.1  - Pre-release version
1.2.0+20231010.1  - Build metadata
```

#### Service Versioning
Each service maintains independent versioning:
- `personal-email-signup-backend`: Independent version
- `login-page-back`: Independent version
- `shared libraries`: Shared version across services

### Release Process

#### 1. Release Branch Creation
```bash
# Create release branch from main
git checkout main
git pull origin main
git checkout -b release/v1.2.0

# Update version numbers
npm version 1.2.0 --no-git-tag-version

# Update changelog
git add .
git commit -m "chore(release): prepare v1.2.0"
git push origin release/v1.2.0
```

#### 2. Release PR and Testing
```bash
# Create release PR
gh pr create --title "Release v1.2.0" \
             --body "Release v1.2.0 with features X, Y, Z" \
             --base main \
             --head release/v1.2.0
```

#### 3. Tag Creation
```bash
# After merge to main
git checkout main
git pull origin main
git tag -a v1.2.0 -m "Release v1.2.0

Features:
- feat(auth): OAuth integration
- feat(signup): Email verification

Bug Fixes:
- fix(auth): Token refresh issue
"

git push origin v1.2.0
```

### Changelog Management

#### Automated Generation
```bash
# Using conventional-changelog
npm install -g conventional-changelog-cli

# Generate changelog
conventional-changelog -p angular -i CHANGELOG.md -s

# Or using git-cliff
git cliff --output CHANGELOG.md
```

#### Manual Changelog Format
```markdown
# Changelog

## [1.2.0] - 2025-10-10

### Features
- **auth**: OAuth integration with Google and GitHub (#123)
- **signup**: Email verification with OTP (#456)

### Bug Fixes
- **auth**: Fix token refresh logic (#789)
- **signup**: Resolve validation error handling (#101)

### Performance
- **shared**: Optimize database connection pooling (#234)

### Security
- **auth**: Address JWT vulnerability (#999)

### Breaking Changes
- **auth**: Changed OAuth callback URL format (see migration guide)
```

---

## 🔧 Automation and Tooling

### Git Hooks

#### Pre-commit Hook
```bash
#!/bin/sh
# .git/hooks/pre-commit

# Run linting
npm run lint

# Run type checking
npm run type-check

# Run unit tests
npm run test:unit

# Check commit message format
npx commitlint --edit $1
```

#### Commit Message Validation
```javascript
// commitlint.config.js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      ['signup', 'login', 'auth', 'shared', 'scripts', 'docs', 'ci', 'deps', 'config']
    ],
    'subject-min-length': [2, 'always', 10],
    'subject-max-length': [2, 'always', 72],
    'body-max-line-length': [2, 'always', 100]
  }
};
```

### GitHub Actions Integration

#### PR Validation
```yaml
name: PR Validation
on:
  pull_request:
    branches: [main, develop]

jobs:
  validate-pr:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Validate PR title
        uses: amannn/action-semantic-pull-request@v5
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

#### Automatic Labeling
```yaml
name: Auto Label
on:
  pull_request:
    types: [opened, edited, synchronize]

jobs:
  label:
    runs-on: ubuntu-latest
    steps:
      - name: Label based on changed files
        uses: actions/labeler@v4
        with:
          repo-token: ${{ secrets.GITHUB_TOKEN }}
```

---

## 🚨 Emergency Procedures

### Hotfix Process

#### Critical Production Issues
```bash
# 1. Create hotfix branch from main
git checkout main
git pull origin main
git checkout -b hotfix/CRITICAL-001-security-fix

# 2. Make minimal fix
git add .
git commit -m "security(auth): fix XSS vulnerability in login form

- Sanitize user input in login endpoint
- Add input validation tests
- Update security documentation

BREAKING CHANGE: Login API now validates input format

Fixes CRITICAL-001"

# 3. Create emergency PR
gh pr create --title "🚨 HOTFIX: Security vulnerability fix" \
             --body "Critical security fix for production" \
             --label "hotfix,security,priority:critical" \
             --reviewer @org/security-guild

# 4. Fast-track review and merge
# 5. Deploy immediately
# 6. Create follow-up tasks for comprehensive fix
```

### Revert Process

#### Failed Deployment Rollback
```bash
# 1. Identify problematic commit
git log --oneline -10

# 2. Create revert commit
git revert <commit-hash> --no-edit

# 3. Create revert PR
gh pr create --title "revert: rollback problematic feature" \
             --body "Rolling back due to production issues" \
             --label "revert,priority:high"
```

---

## 📊 Metrics and Monitoring

### PR Metrics

#### Key Indicators
- **PR Size**: Lines changed per PR (target: <500 lines)
- **Review Time**: Time from PR creation to merge (target: <24h)
- **Rework Rate**: PRs requiring significant changes (target: <20%)
- **Merge Rate**: PRs merged vs. closed (target: >90%)

#### Monitoring Dashboard
```yaml
# GitHub Insights Configuration
pull_request_metrics:
  - size_distribution
  - review_time
  - approval_rate
  - merge_time
  - rework_frequency
```

### Commit Quality Metrics

#### Tracking
- Conventional commit compliance rate
- Commit message quality scores
- Revert frequency
- Hotfix frequency

---

## 📚 Training and Resources

### Onboarding Checklist

#### New Team Members
- [ ] Read governance documentation
- [ ] Configure git with proper name/email
- [ ] Install and configure commitlint
- [ ] Set up git hooks
- [ ] Complete first PR with mentor review
- [ ] Understand team-specific workflows

### Tools and Setup

#### Required Tools
```bash
# Install commitlint
npm install -g @commitlint/cli @commitlint/config-conventional

# Install GitHub CLI
brew install gh

# Configure git hooks
npx husky install
```

#### Recommended VS Code Extensions
- GitLens
- Conventional Commits
- GitHub Pull Requests
- Git Graph

---

## 🔗 Additional Resources

### Documentation Links
- [GitHub Flow Guide](./docs/GITHUB_FLOW.md)
- [Architecture Decision Records](./docs/adr/)
- [API Documentation](./docs/api/)
- [Deployment Guide](./docs/deployment/)

### External Resources
- [Conventional Commits Specification](https://www.conventionalcommits.org/)
- [Semantic Versioning](https://semver.org/)
- [GitHub Flow](https://guides.github.com/introduction/flow/)

---

**Document Version**: 2.0  
**Last Updated**: 7 February 2026  
**Next Review**: 7 May 2026  
**Owner**: @org/devops-infra