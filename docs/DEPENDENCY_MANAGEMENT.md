# Dependency Management and Versioning Policy

## Overview

This document defines the dependency management strategy, versioning policies, and shared library approach for the `auth-services-monorepo` to ensure consistency, security, and maintainability across all services.

---

## 📦 Dependency Management Strategy

### Monorepo Dependency Approach

#### Service-Level Dependencies
Each service maintains its own `package.json` with service-specific dependencies:

```bash
services/
├── personal-email-signup-backend/
│   ├── package.json          # Service-specific dependencies
│   └── package-lock.json     # Locked versions for reproducibility
└── login-page-back/
    ├── package.json          # Service-specific dependencies (if npm-based)
    └── package-lock.json     # Or alternative lockfile (yarn.lock, etc.)
```

#### Root-Level Dependencies
Root `package.json` contains shared tooling and development dependencies:

```json
{
  "name": "auth-services-monorepo",
  "private": true,
  "workspaces": [
    "services/*",
    "src/shared"
  ],
  "devDependencies": {
    "eslint": "^8.0.0",
    "prettier": "^3.0.0",
    "husky": "^8.0.0",
    "commitlint": "^18.0.0",
    "typescript": "^5.0.0"
  },
  "scripts": {
    "build": "npm run build --workspaces",
    "test": "npm run test --workspaces",
    "lint": "npm run lint --workspaces"
  }
}
```

### Workspace Configuration

#### npm Workspaces Setup
```json
{
  "workspaces": {
    "packages": [
      "services/*",
      "src/shared",
      "packages/*"
    ]
  }
}
```

#### Service Package Configuration
```json
{
  "name": "@auth-monorepo/personal-email-signup-backend",
  "version": "1.2.3",
  "private": true,
  "dependencies": {
    "@nestjs/core": "^10.0.0",
    "@auth-monorepo/shared": "workspace:*"
  }
}
```

---

## 🔄 Shared Dependencies Strategy

### Shared Library Structure

#### Core Shared Libraries
```bash
src/
├── shared/
│   ├── package.json          # Shared library package
│   ├── auth/                 # Authentication utilities
│   │   ├── jwt.ts
│   │   ├── middleware.ts
│   │   └── types.ts
│   ├── database/             # Database utilities
│   │   ├── connection.ts
│   │   ├── migrations.ts
│   │   └── models/
│   ├── email/                # Email utilities
│   │   ├── templates/
│   │   ├── sender.ts
│   │   └── validation.ts
│   ├── logging/              # Logging utilities
│   │   ├── winston.config.ts
│   │   └── formatters.ts
│   └── validation/           # Input validation
│       ├── schemas/
│       └── decorators.ts
```

#### Shared Library Package.json
```json
{
  "name": "@auth-monorepo/shared",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    "./auth": "./dist/auth/index.js",
    "./database": "./dist/database/index.js",
    "./email": "./dist/email/index.js",
    "./logging": "./dist/logging/index.js",
    "./validation": "./dist/validation/index.js"
  },
  "dependencies": {
    "jsonwebtoken": "^9.0.0",
    "bcryptjs": "^2.4.0",
    "winston": "^3.10.0",
    "joi": "^17.9.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0"
  }
}
```

### Dependency Categories

#### Core Dependencies (Shared Across Services)
- **Authentication**: `jsonwebtoken`, `bcryptjs`, `passport`
- **Database**: `pg`, `redis`, `prisma`
- **Validation**: `joi`, `class-validator`, `zod`
- **Logging**: `winston`, `morgan`
- **HTTP**: `axios`, `express`
- **Utilities**: `lodash`, `date-fns`, `uuid`

#### Service-Specific Dependencies
- **NestJS Stack**: `@nestjs/*` packages for signup service
- **Express Stack**: `express` and middleware for login service
- **Testing**: `jest`, `supertest`, `@nestjs/testing`
- **ORM**: `prisma`, `typeorm` (service-specific choice)

#### Development Dependencies (Root Level)
- **Code Quality**: `eslint`, `prettier`, `husky`
- **Build Tools**: `typescript`, `ts-node`, `nodemon`
- **Testing**: `jest` (global configuration)
- **Security**: `audit-ci`, `snyk`

### Dependency Version Management

#### Version Pinning Strategy
```json
{
  "dependencies": {
    "@nestjs/core": "10.2.1",        // Exact version for stability
    "express": "^4.18.0",            // Compatible version for updates
    "jsonwebtoken": "~9.0.2",        // Patch-level updates only
    "typescript": "^5.0.0"           // Minor updates allowed
  }
}
```

#### Version Update Policy
- **Major versions**: Require ADR and team approval
- **Minor versions**: Allowed with testing
- **Patch versions**: Automated updates with CI validation
- **Security patches**: Immediate updates required

---

## 🏷️ Service Versioning Policy

### Semantic Versioning

#### Version Format
```
MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]

Examples:
1.0.0         # Initial release
1.1.0         # New features added
1.1.1         # Bug fixes
2.0.0         # Breaking changes
1.2.0-beta.1  # Pre-release
1.2.0+20251010.1  # Build metadata
```

#### Version Increment Rules

##### MAJOR (Breaking Changes)
- API endpoint removal or significant change
- Database schema breaking changes
- Authentication method changes
- Configuration format changes
- Framework major version updates

##### MINOR (New Features)
- New API endpoints
- New features (backward compatible)
- New configuration options
- Dependency minor updates
- Performance improvements

##### PATCH (Bug Fixes)
- Bug fixes
- Security patches
- Documentation updates
- Dependency patch updates
- Configuration tweaks

### Independent Service Versioning

#### Service Version Management
```json
{
  "services": {
    "personal-email-signup-backend": "1.2.3",
    "login-page-back": "2.1.0",
    "shared-libraries": "1.0.5"
  }
}
```

#### Release Coordination
- **Independent releases**: Services can be released separately
- **Coordinated releases**: Major releases coordinated across services
- **Hotfixes**: Can be applied to individual services
- **Dependencies**: Shared library versions tracked

### Release Process

#### Development Workflow
```bash
# Feature development
git checkout -b feature/AUTH-123-new-feature
# Development and testing
git commit -m "feat(auth): add new authentication method"

# Version bump (automated or manual)
npm version minor  # Updates package.json version

# Create release PR
gh pr create --title "Release v1.2.0" --body "Release notes..."

# After merge, create tag
git tag v1.2.0
git push origin v1.2.0
```

#### Automated Version Management
```json
{
  "scripts": {
    "version:patch": "npm version patch --no-git-tag-version",
    "version:minor": "npm version minor --no-git-tag-version",
    "version:major": "npm version major --no-git-tag-version",
    "release:prepare": "npm run build && npm run test && npm run version:minor",
    "release:tag": "git tag v$(npm pkg get version | tr -d '\"')"
  }
}
```

---

## 🔄 Dependency Update Procedures

### Update Categories

#### Security Updates (Immediate)
```bash
# Check for security vulnerabilities
npm audit

# Fix high/critical vulnerabilities immediately
npm audit fix

# For manual fixes
npm install package@latest
```

#### Regular Updates (Weekly)
```bash
# Check outdated packages
npm outdated

# Update patch versions
npm update

# Review and update minor versions
npm install package@^new-version
```

#### Major Updates (Quarterly)
```bash
# Plan major updates
npm outdated | grep -E '^[a-zA-Z].*[0-9]+\.[0-9]+\.[0-9]+.*[0-9]+\.[0-9]+\.[0-9]+'

# Create dedicated branch for major updates
git checkout -b chore/deps-major-update-q4-2025

# Update dependencies incrementally
npm install package@latest

# Test thoroughly
npm run test:all
npm run test:integration
npm run test:e2e
```

### Update Validation Process

#### Automated Checks
```yaml
# GitHub Actions workflow for dependency updates
name: Dependency Update Validation
on:
  pull_request:
    paths:
      - '**/package.json'
      - '**/package-lock.json'

jobs:
  validate-deps:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install dependencies
        run: npm ci
        
      - name: Security audit
        run: npm audit --audit-level moderate
        
      - name: Run tests
        run: npm run test:all
        
      - name: Check bundle size
        run: npm run analyze:bundle
```

#### Manual Review Process
1. **Security Impact**: Review security advisories
2. **Breaking Changes**: Check release notes for breaking changes
3. **Performance Impact**: Monitor bundle size and performance metrics
4. **Compatibility**: Ensure compatibility with existing code
5. **Documentation**: Update documentation if needed

### Conflict Resolution

#### Version Conflicts
```bash
# Check for version conflicts
npm ls

# Resolve conflicts using resolutions (package.json)
{
  "resolutions": {
    "lodash": "4.17.21",
    "minimist": "1.2.6"
  }
}

# Or using overrides (npm 8.3+)
{
  "overrides": {
    "lodash": "4.17.21"
  }
}
```

#### Peer Dependency Issues
```bash
# Install peer dependencies
npm install --save-peer

# Use legacy peer deps flag if needed
npm install --legacy-peer-deps
```

---

## 🧪 Testing Strategy for Dependencies

### Dependency Testing Levels

#### Unit Tests
- Test shared library functions
- Mock external dependencies
- Validate API contracts

#### Integration Tests
- Test service-to-service communication
- Validate database connections
- Test external API integrations

#### Dependency Tests
```bash
# Test shared library usage
npm run test:shared

# Test service dependencies
npm run test:integration -- --testPathPattern=dependencies

# Test version compatibility
npm run test:compatibility
```

### Continuous Integration

#### Dependency Security Scanning
```yaml
- name: Dependency Security Scan
  run: |
    npm audit --audit-level moderate
    npx audit-ci --moderate
```

#### License Compliance
```yaml
- name: License Check
  run: |
    npx license-checker --onlyAllow 'MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC'
```

#### Bundle Analysis
```yaml
- name: Bundle Size Analysis
  run: |
    npm run build
    npx bundlesize
```

---

## 📊 Monitoring and Metrics

### Dependency Health Metrics

#### Key Performance Indicators
- **Vulnerability Count**: Number of known vulnerabilities
- **Update Frequency**: How often dependencies are updated
- **License Compliance**: Percentage of compliant licenses
- **Bundle Size**: Total dependency bundle size
- **Build Time**: Impact of dependencies on build performance

#### Monitoring Tools
```json
{
  "scripts": {
    "deps:audit": "npm audit",
    "deps:outdated": "npm outdated",
    "deps:licenses": "npx license-checker",
    "deps:analyze": "npx analyze-deps",
    "deps:report": "npm run deps:audit && npm run deps:outdated && npm run deps:licenses"
  }
}
```

### Automated Reporting

#### Weekly Dependency Report
```bash
#!/bin/bash
# scripts/dependency-report.sh

echo "# Weekly Dependency Report"
echo "Generated: $(date)"
echo ""

echo "## Security Audit"
npm audit --json | jq '.metadata'

echo "## Outdated Packages"
npm outdated --json | jq 'keys[]'

echo "## License Summary"
npx license-checker --summary
```

#### Dashboard Integration
- **Grafana**: Dependency metrics dashboard
- **Slack**: Automated weekly reports
- **GitHub**: Dependency update notifications

---

## 🔒 Security Policies

### Dependency Security

#### Security Scanning
- **Automated scanning**: Every PR and nightly builds
- **Vulnerability database**: npm audit + Snyk + GitHub Security Advisories
- **Response time**: Critical vulnerabilities patched within 24 hours
- **Medium/Low**: Addressed in next scheduled update cycle

#### Approved Dependencies

#### Security-Approved Libraries
```json
{
  "approvedDependencies": {
    "authentication": ["jsonwebtoken", "bcryptjs", "passport"],
    "database": ["pg", "mongodb", "redis"],
    "validation": ["joi", "yup", "class-validator"],
    "encryption": ["crypto", "node-forge"],
    "http": ["axios", "node-fetch"]
  }
}
```

#### Restricted Dependencies
```json
{
  "restrictedDependencies": {
    "vulnerable": ["event-stream", "eslint-scope"],
    "deprecated": ["request", "bower"],
    "license-incompatible": ["gpl-licensed-package"]
  }
}
```

### Supply Chain Security

#### Package Verification
```bash
# Verify package integrity
npm ci --audit

# Check package signatures
npm audit signatures

# Verify lockfile integrity
npm ci --frozen-lockfile
```

#### Private Registry (Future)
```json
{
  "npmrc": {
    "registry": "https://npm.company.com/",
    "always-auth": true,
    "@company:registry": "https://npm.company.com/"
  }
}
```

---

## 🛠️ Tools and Automation

### Development Tools

#### Package Management
- **Primary**: npm (with workspaces)
- **Alternative**: yarn (with workspaces) if needed
- **Lock files**: Always committed and validated

#### Dependency Analysis
```bash
# Install analysis tools
npm install -g depcheck npm-check-updates audit-ci

# Check for unused dependencies
npx depcheck

# Check for updates
npx npm-check-updates

# Security audit with CI integration
npx audit-ci --config audit-ci.json
```

#### Configuration Files

##### audit-ci.json
```json
{
  "moderate": true,
  "high": true,
  "critical": true,
  "allowlist": [],
  "report-type": "full",
  "pass-enoaudit": true
}
```

##### .npmrc
```ini
audit-level=moderate
fund=false
save-exact=true
engine-strict=true
```

### Automation Scripts

#### Dependency Update Automation
```bash
#!/bin/bash
# scripts/update-dependencies.sh

set -e

echo "🔄 Starting dependency update process..."

# Check current status
npm outdated

# Update patch versions
echo "📦 Updating patch versions..."
npm update

# Run tests
echo "🧪 Running tests..."
npm run test:all

# Security audit
echo "🔒 Running security audit..."
npm audit

# Generate report
echo "📊 Generating update report..."
npm run deps:report > dependency-update-report.md

echo "✅ Dependency update complete!"
```

#### Weekly Maintenance
```bash
#!/bin/bash
# scripts/weekly-maintenance.sh

# Update dependencies
./scripts/update-dependencies.sh

# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Run full test suite
npm run test:all

# Update documentation if needed
npm run docs:generate

# Create maintenance PR if changes exist
if [[ -n $(git status --porcelain) ]]; then
  git checkout -b chore/weekly-maintenance-$(date +%Y-%m-%d)
  git add .
  git commit -m "chore: weekly dependency maintenance"
  gh pr create --title "Weekly Maintenance" --body "Automated dependency updates"
fi
```

---

## 📚 Documentation and Training

### Team Guidelines

#### Dependency Decision Matrix

| Criteria | Weight | Evaluation Questions |
|----------|--------|---------------------|
| **Security** | High | Recent vulnerabilities? Active maintenance? |
| **Performance** | High | Bundle size impact? Runtime performance? |
| **Compatibility** | Medium | Works with existing stack? Migration effort? |
| **Community** | Medium | Active community? Good documentation? |
| **License** | High | Compatible license? Legal approval? |
| **Maintenance** | Medium | Active development? Regular releases? |

#### Best Practices
1. **Evaluate before adding**: Every new dependency requires justification
2. **Prefer maintained packages**: Active development and security updates
3. **Minimize dependencies**: Use built-in functionality when possible
4. **Document decisions**: ADRs for significant dependency choices
5. **Regular updates**: Scheduled update cycles
6. **Security first**: Security updates take priority

### Training Resources

#### Onboarding Checklist
- [ ] Understand monorepo dependency strategy
- [ ] Learn shared library usage patterns
- [ ] Practice dependency update procedures
- [ ] Review security policies
- [ ] Complete hands-on workshop

#### Documentation Links
- [npm Workspaces Guide](https://docs.npmjs.com/cli/v7/using-npm/workspaces)
- [Semantic Versioning](https://semver.org/)
- [Security Best Practices](https://docs.npmjs.com/auditing-package-dependencies-for-security-vulnerabilities)

---

## 🔄 Review and Governance

### Policy Review

#### Regular Reviews
- **Monthly**: Security vulnerability review
- **Quarterly**: Dependency update assessment
- **Bi-annually**: Policy effectiveness review
- **Annually**: Strategy alignment with business goals

#### Review Criteria
- **Security posture**: Vulnerability trends and response times
- **Performance impact**: Bundle size and build time trends
- **Developer experience**: Ease of dependency management
- **Maintenance overhead**: Time spent on dependency management

### Governance Structure

#### Roles and Responsibilities

##### Dependency Committee
- **Members**: @devops-team-lead, @security-team-lead, @backend-team-lead
- **Responsibilities**: Policy decisions, major dependency approvals
- **Meetings**: Monthly review sessions

##### Service Owners
- **Responsibilities**: Day-to-day dependency management
- **Authority**: Minor and patch updates
- **Escalation**: Major updates to dependency committee

##### Security Team
- **Responsibilities**: Security scanning, vulnerability response
- **Authority**: Emergency security updates
- **Reporting**: Weekly security status reports

### Exception Process

#### Emergency Updates
1. **Identify**: Critical security vulnerability or production issue
2. **Assess**: Impact and urgency evaluation
3. **Approve**: Security team or service lead approval
4. **Implement**: Immediate update with minimal testing
5. **Validate**: Post-update validation and monitoring
6. **Document**: Exception documentation and lessons learned

#### Policy Exceptions
- **Request**: Formal exception request with justification
- **Review**: Dependency committee evaluation
- **Approval**: Committee vote with documented rationale
- **Monitor**: Exception tracking and periodic review

---

## 📞 Support and Contact

### Team Contacts
- **Dependency Committee**: dependency-committee@company.com
- **Security Team**: security@company.com
- **DevOps Team**: devops@company.com
- **Backend Team**: backend@company.com

### Communication Channels
- **General**: #engineering
- **Dependencies**: #dependency-management
- **Security**: #security-alerts
- **Emergency**: @devops-oncall

### Resources
- **Documentation**: [Dependency Management Guide](./docs/dependency-management/)
- **Tools**: [Internal Tool Registry](./docs/tools/)
- **Training**: [Dependency Workshop Materials](./docs/training/)

---

**Document Version**: 2.0  
**Last Updated**: 7 February 2026  
**Next Review**: 7 May 2026  
**Owner**: @org/devops-infra