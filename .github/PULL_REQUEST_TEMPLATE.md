---
name: Pull Request
about: Template for all pull requests to ensure consistent quality and review process
title: "[SERVICE] Brief description of changes"
labels: ['needs-review']
assignees: ''
---

# Pull Request Description

## 📋 Summary
<!-- Provide a brief summary of your changes -->

## 🎯 Type of Change
<!-- Check the type that applies to your PR -->
- [ ] 🐛 **Bug fix** (non-breaking change that fixes an issue)
- [ ] ✨ **New feature** (non-breaking change that adds functionality)  
- [ ] 💥 **Breaking change** (fix or feature that would cause existing functionality to not work as expected)
- [ ] 📚 **Documentation update** (changes to documentation only)
- [ ] 🔧 **Refactoring** (code change that neither fixes a bug nor adds a feature)
- [ ] ⚡ **Performance improvement** (code change that improves performance)
- [ ] 🔒 **Security update** (change that addresses security vulnerabilities)
- [ ] 🏗️ **Infrastructure** (CI/CD, build tools, deployment changes)
- [ ] 🧪 **Tests** (adding missing tests or correcting existing tests)

## 🔗 Related Issues
<!-- Link to related issues -->
- Closes #(issue number)
- Related to #(issue number)
- Addresses #(issue number)

## 🚀 Services Affected
<!-- Check all services that are affected by this change -->
- [ ] `personal-email-signup-backend` (NestJS signup service)
- [ ] `login-page-back` (Express/NestJS auth service)
- [ ] Shared libraries (`src/`)
- [ ] Infrastructure scripts (`scripts/`)
- [ ] Documentation (`docs/`)
- [ ] CI/CD workflows (`.github/workflows/`)
- [ ] Security policies (`policies/`)

---

## 🧪 Testing Checklist

### ✅ Code Quality
- [ ] Code follows established style guidelines and passes linting
- [ ] TypeScript compilation passes without errors
- [ ] Code is properly documented with JSDoc/TSDoc comments
- [ ] No console.log statements left in production code
- [ ] Error handling is implemented appropriately

### ✅ Testing
- [ ] **Unit tests** added/updated and passing (`npm run test`)
- [ ] **Integration tests** added/updated and passing (`npm run test:integration`)
- [ ] **E2E tests** added/updated and passing (`npm run test:e2e`)
- [ ] **Contract tests** added/updated if APIs changed (`npm run test:contract`)
- [ ] Test coverage maintained or improved
- [ ] Manual testing completed in local environment

### ✅ Security
- [ ] No hardcoded secrets, passwords, or API keys
- [ ] Input validation and sanitization implemented
- [ ] Authentication and authorization checks in place
- [ ] Dependencies scanned for vulnerabilities (`npm audit`)
- [ ] Secret scanning passes (`npm run secrets:scan`)
- [ ] HTTPS used for all external communications

### ✅ Performance
- [ ] Database queries optimized and indexed appropriately
- [ ] No N+1 query problems introduced
- [ ] Caching strategy considered and implemented if needed
- [ ] Memory leaks checked and prevented
- [ ] Load testing performed for significant changes

### ✅ Database Changes
- [ ] Database migrations are reversible
- [ ] Migration scripts tested in staging environment
- [ ] Backup strategy considered for production deployment
- [ ] Database indexes updated if query patterns changed
- [ ] Data integrity constraints maintained

---

## 📝 Implementation Details

### 🏗️ Architecture Changes
<!-- Describe any architectural changes -->

### 🔧 API Changes
<!-- List any API endpoint changes -->
- **New endpoints:**
- **Modified endpoints:**
- **Deprecated endpoints:**
- **Breaking changes:**

### 🗄️ Database Changes
<!-- Describe database schema changes -->
- **New tables:**
- **Modified tables:**
- **New indexes:**
- **Data migrations:**

### 🔐 Security Considerations
<!-- Describe security implications -->

### ⚡ Performance Impact
<!-- Describe performance implications -->

---

## 🚀 Deployment

### 🛠️ Deployment Requirements
- [ ] No special deployment requirements
- [ ] Database migration required
- [ ] Environment variables need to be updated
- [ ] External service configuration required
- [ ] Feature flags need to be configured
- [ ] Cache needs to be cleared
- [ ] CDN needs to be invalidated

### 📋 Deployment Steps
<!-- List specific deployment steps if needed -->
1. 
2. 
3. 

### 🔄 Rollback Plan
<!-- Describe rollback strategy if deployment fails -->

---

## 📚 Documentation

### ✅ Documentation Updates
- [ ] **README** updated if setup/installation changed
- [ ] **API documentation** updated if endpoints changed
- [ ] **Architecture docs** updated if design changed
- [ ] **ADR** (Architecture Decision Record) created for major decisions
- [ ] **Changelog** updated with user-facing changes
- [ ] **Migration guide** created for breaking changes

### 📖 Additional Context
<!-- Any additional information reviewers should know -->

---

## 👥 Review Requirements

### 🔍 Required Reviewers
<!-- Will be auto-assigned based on CODEOWNERS, but you can request specific reviewers -->

**Team Reviews Required:**
- [ ] Service team approval (auto-assigned via CODEOWNERS)
- [ ] Security team approval (for security-related changes)
- [ ] DevOps team approval (for infrastructure changes)
- [ ] Architecture team approval (for significant design changes)

### 💬 Review Focus Areas
<!-- Guide reviewers on what to focus on -->
- [ ] **Code quality and maintainability**
- [ ] **Security and compliance**
- [ ] **Performance implications**
- [ ] **API design and backwards compatibility**
- [ ] **Test coverage and quality**
- [ ] **Documentation completeness**

---

## 🎯 Pre-Merge Checklist

### ✅ Before Requesting Review
- [ ] Self-review completed
- [ ] All CI checks passing
- [ ] Conflicts resolved and branch is up-to-date
- [ ] PR description is complete and accurate
- [ ] Screenshots/videos added for UI changes
- [ ] Breaking changes documented

### ✅ Before Merging
- [ ] All required approvals received
- [ ] All CI/CD checks passing
- [ ] All review comments addressed
- [ ] Documentation reviewed and approved
- [ ] Deployment plan confirmed
- [ ] Monitoring/alerting configured for new features

---

## 📊 Metrics and Monitoring

### 📈 Success Metrics
<!-- How will you measure if this change is successful? -->

### 🔔 Monitoring
- [ ] **Logs** - New log statements added for debugging
- [ ] **Metrics** - New metrics added for monitoring
- [ ] **Alerts** - Alert rules updated for new functionality
- [ ] **Dashboards** - Monitoring dashboards updated

---

## 🚨 Risk Assessment

### 🔴 High Risk Changes
- [ ] Database schema changes
- [ ] Authentication/authorization changes
- [ ] Payment or financial logic changes
- [ ] Data migration or cleanup
- [ ] External API integration changes

### 🟡 Medium Risk Changes
- [ ] Business logic changes
- [ ] Configuration changes
- [ ] Dependency updates
- [ ] Performance optimizations

### 🟢 Low Risk Changes
- [ ] UI/UX improvements
- [ ] Documentation updates
- [ ] Test additions
- [ ] Code refactoring (no behavior change)

---

## 📞 Emergency Contacts

If this PR introduces critical changes, list emergency contacts:

- **Service Owner**: @service-owner
- **On-Call Engineer**: @oncall-engineer  
- **Team Lead**: @team-lead

---

<!-- 
## 👨‍💻 For Reviewers

### Review Guidelines
1. **Functionality**: Does the code do what it's supposed to do?
2. **Security**: Are there any security vulnerabilities?
3. **Performance**: Will this impact performance negatively?
4. **Maintainability**: Is the code readable and maintainable?
5. **Testing**: Are there adequate tests?
6. **Documentation**: Is the change well documented?

### Approval Guidelines
- **Approve**: Change is ready to merge
- **Request Changes**: Issues must be addressed before merge
- **Comment**: Suggestions for improvement (non-blocking)

Remember: All changes to main require CODEOWNER approval!
-->

---

**PR Checklist Complete**: <!-- Check this when all applicable items above are completed -->
- [ ] ✅ Ready for review and merge