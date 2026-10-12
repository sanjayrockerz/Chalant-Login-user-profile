 # Contributing to Auth Services Monorepo

Welcome to the `auth-services-monorepo`! This guide will help you get started with contributing to our authentication and user management services.

## 📋 Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Service Architecture](#service-architecture)
- [Testing Guidelines](#testing-guidelines)
- [Code Quality Standards](#code-quality-standards)
- [Deployment Process](#deployment-process)
- [Troubleshooting](#troubleshooting)

---

## 🚀 Getting Started

### Prerequisites

#### Required Software
- **Node.js**: v18.x or later ([Download](https://nodejs.org/))
- **npm**: v9.x or later (comes with Node.js)
- **Git**: Latest version ([Download](https://git-scm.com/))
- **Docker**: Latest version ([Download](https://docker.com/)) - for local development
- **PostgreSQL**: v14+ (or use Docker)
- **Redis**: v6+ (or use Docker)

#### Optional Tools
- **GitHub CLI**: For enhanced PR workflows (`gh`)
- **VS Code**: Recommended editor with workspace settings configured
- **Postman/Insomnia**: For API testing

### Repository Setup

#### 1. Clone and Setup
```bash
# Clone the repository
git clone https://github.com/bigdaddyhara/auth-services-monorepo.git
cd auth-services-monorepo

# Install root dependencies (if any)
npm install

# Set up git hooks for code quality
npx husky install

# Configure git user (use your GitHub email)
git config user.name "Your Name"
git config user.email "your.email@company.com"
```

#### 2. Service Setup

##### Personal Email Signup Backend (NestJS)
```bash
cd services/personal-email-signup-backend

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Configure environment variables
# Edit .env with your local settings:
# - DATABASE_URL (PostgreSQL connection)
# - REDIS_URL (Redis connection)
# - JWT_SECRET (random string for development)
# - EMAIL_* (email service configuration)

# Run database migrations
npm run migration:deploy

# Seed development data (optional)
npm run db:seed

# Start development server
npm run start:dev
```

##### Login Page Backend (Express/NestJS)
```bash
cd services/login-page-back

# Check for package.json (may use alternative build system)
if [ -f "package.json" ]; then
  npm install
  npm run start:dev
else
  # Alternative setup - check for Dockerfile, Makefile, or custom scripts
  echo "Using alternative build system - check service README"
fi
```

#### 3. Development Environment

##### Using Docker (Recommended)
```bash
# Start all services with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

##### Manual Setup
```bash
# Start PostgreSQL (macOS with Homebrew)
brew services start postgresql@14

# Start Redis
brew services start redis

# Or use Docker for databases only
docker run -d --name postgres -p 5432:5432 -e POSTGRES_PASSWORD=password postgres:14
docker run -d --name redis -p 6379:6379 redis:6-alpine
```

---

## 🔄 Development Workflow

### Branch Strategy

#### Branch Types
- **`main`** - Production-ready branch; enforces required checks (`lint`, `unit-tests`, `integration-tests`, `e2e-smoke`, `codecov`, `trivy-scan`, `iac-validate`) and two CODEOWNER approvals
- **`release/*`** - Short-lived release hardening branches with maintainer approval and signing requirements
- **`develop`** - Optional integration branch; requires `lint` and `unit-tests` plus external review
- **`feature/*` & `bugfix/*`** - Standard delivery branches; keep rebased on `main`
- **`hotfix/*`** - Incident response branches; follow governance escalation steps before merging
- **`infra/*`, `security/*`** - Operational changes; trigger CODEOWNER review from `@org/devops-infra` and `@org/security-guild`

Refer to `docs/BRANCH_PROTECTION.md` for the full rule configuration applied in GitHub settings.

#### Creating Feature Branches
```bash
# Always start from latest main
git checkout main
git pull origin main

# Create feature branch
git checkout -b feature/AUTH-123-oauth-integration

# Make your changes...
git add .
git commit -m "feat(auth): add OAuth provider configuration"

# Push branch
git push origin feature/AUTH-123-oauth-integration
```

### Commit Guidelines

#### Conventional Commits Format
```
<type>(<scope>): <subject>

<body>

<footer>
```

#### Examples
```bash
# Feature
feat(signup): add email verification with OTP
feat(auth): implement OAuth2 integration

# Bug fix
fix(login): resolve session timeout handling
fix(signup): fix validation error messages

# Documentation
docs(api): update authentication endpoints
docs(readme): add setup instructions

# Infrastructure
ci(workflows): add automated deployment
build(deps): update NestJS to v10
```

### Pull Request Process

#### 1. Before Creating PR
```bash
# Ensure branch is up to date
git fetch origin
git rebase origin/main

# Run local checks
npm run lint
npm run test
npm run build

# Push final changes
git push origin feature/your-branch
```

#### 2. Create Pull Request
```bash
# Using GitHub CLI (recommended)
gh pr create --title "feat(auth): implement OAuth integration" \
             --body-file .github/PULL_REQUEST_TEMPLATE.md \
             --reviewer @org/authn-authz

# Or create via GitHub web interface
```

#### 3. PR Requirements
- [ ] All CI checks passing
- [ ] Code review approval from CODEOWNERS
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No merge conflicts

---

## 🏗️ Service Architecture

### Monorepo Structure
```
auth-services-monorepo/
├── services/
│   ├── personal-email-signup-backend/    # NestJS signup service
│   └── login-page-back/                  # Express/NestJS auth service
├── src/                                  # Shared libraries
├── scripts/                              # Build and deployment scripts
├── docs/                                 # Documentation
├── policies/                             # Security and governance policies
└── .github/                              # GitHub workflows and templates
```

### Service Boundaries

#### Personal Email Signup Backend
- **Purpose**: User registration and email verification
- **Technology**: NestJS, TypeScript, PostgreSQL, Redis
- **Responsibilities**:
  - User account creation
  - Email verification with OTP
  - Password reset workflows
  - User profile management

#### Login Page Backend
- **Purpose**: Authentication and session management
- **Technology**: Express/NestJS, adaptive build system
- **Responsibilities**:
  - User authentication (login/logout)
  - JWT token management
  - Session handling
  - OAuth integration

### Shared Libraries

#### Location: `src/`
- **Common utilities**: Logging, validation, error handling
- **Shared types**: TypeScript interfaces and types
- **Authentication**: JWT utilities, middleware
- **Database**: Connection management, common queries

---

## 🧪 Testing Guidelines

### Testing Strategy

#### Test Types and Coverage
- **Unit Tests**: 80%+ coverage for business logic
- **Integration Tests**: API endpoint testing
- **Contract Tests**: Service-to-service communication
- **E2E Tests**: Critical user journeys

#### Running Tests

##### For NestJS Services
```bash
cd services/personal-email-signup-backend

# Unit tests
npm run test

# Integration tests  
npm run test:integration

# E2E tests
npm run test:e2e

# Contract tests
npm run test:contract

# All tests with coverage
npm run test:all

# Watch mode for development
npm run test:watch
```

##### For Other Services
```bash
cd services/login-page-back

# Check available test scripts
npm run | grep test

# Or use service-specific commands
make test        # If Makefile exists
yarn test        # If using Yarn
./test.sh        # If custom script exists
```

### Test Database Setup

#### Using Docker
```bash
# Start test database
docker run -d --name test-postgres \
  -e POSTGRES_DB=auth_test \
  -e POSTGRES_USER=test \
  -e POSTGRES_PASSWORD=test \
  -p 5433:5432 \
  postgres:14

# Configure test environment
export DATABASE_URL="postgresql://test:test@localhost:5433/auth_test"
export REDIS_URL="redis://localhost:6379/1"
```

#### Test Data Management
```bash
# Reset test database
npm run migration:reset

# Seed test data
npm run db:seed:test

# Clean up after tests
npm run test:cleanup
```

---

## 🎯 Code Quality Standards

### Linting and Formatting

#### Configuration Files
- **ESLint**: `.eslintrc.js` - JavaScript/TypeScript linting
- **Prettier**: `.prettierrc` - Code formatting
- **TypeScript**: `tsconfig.json` - Type checking

#### Running Quality Checks
```bash
# Lint code
npm run lint

# Fix auto-fixable issues
npm run lint:fix

# Format code
npm run format

# Type checking
npm run type-check

# All quality checks
npm run quality:check
```

### Code Review Checklist

#### For Authors
- [ ] Self-review completed
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No hardcoded secrets
- [ ] Error handling implemented
- [ ] Performance considerations addressed

#### For Reviewers
- [ ] Code follows established patterns
- [ ] Security best practices followed
- [ ] Performance implications considered
- [ ] Test coverage adequate
- [ ] Documentation complete

### Security Guidelines

#### Best Practices
- **Input Validation**: Validate all user inputs
- **Authentication**: Use JWT with proper expiration
- **Authorization**: Implement role-based access control
- **Secrets Management**: Use environment variables
- **SQL Injection**: Use parameterized queries
- **XSS Prevention**: Sanitize outputs

#### Security Scanning
```bash
# Dependency audit
npm audit

# Secret scanning
npm run secrets:scan

# Security linting
npm run lint:security
```

---

## 🚀 Deployment Process

### CI/CD Pipelines

#### Automated Deployments
- **Feature branches**: Run tests and code quality checks
- **Main branch**: Deploy to staging automatically
- **Tagged releases**: Deploy to production with approval

#### Manual Deployment Triggers
```bash
# Staging deployment
git commit -m "feat(auth): new feature

deploy:staging"

# Production deployment (requires approval)
git tag v1.2.0
git push origin v1.2.0
```

### Environment Configuration

#### Environment Variables
```bash
# Required for all services
NODE_ENV=development|staging|production
LOG_LEVEL=debug|info|warn|error

# Database connections
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your-secret-key
JWT_EXPIRY=7d

# Email service
EMAIL_FROM=noreply@company.com
EMAIL_SERVICE=sendgrid|ses|smtp
```

#### Service-Specific Configuration
See individual service README files for detailed configuration:
- [Signup Service README](./services/personal-email-signup-backend/README.md)
- [Login Service README](./services/login-page-back/README.md)

---

## 🐛 Troubleshooting

### Common Issues

#### Database Connection Issues
```bash
# Check database status
pg_isready -h localhost -p 5432

# Test connection
psql $DATABASE_URL -c "SELECT 1;"

# Reset migrations
npm run migration:reset
npm run migration:deploy
```

#### Redis Connection Issues
```bash
# Test Redis connection
redis-cli ping

# Clear Redis cache
redis-cli flushall
```

#### Port Conflicts
```bash
# Check what's using port 3000
lsof -i :3000

# Kill process using port
kill -9 $(lsof -ti:3000)
```

#### Node Modules Issues
```bash
# Clear node modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear npm cache
npm cache clean --force
```

### Getting Help

#### Internal Resources
- **Documentation**: Check `docs/` directory
- **API Docs**: Available at service endpoints `/api/docs`
- **Architecture Decisions**: See `docs/adr/`

#### Team Contacts
- **Backend Team**: backend@company.com, #backend-team
- **Auth Team**: auth@company.com, #auth-security  
- **DevOps Team**: devops@company.com, #devops-infra
- **General**: engineering@company.com, #engineering

#### External Resources
- [NestJS Documentation](https://docs.nestjs.com/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

---

## 📝 Additional Guidelines

### Path Filters and Selective CI

Our CI system uses path filters to run only relevant tests when specific services change:

#### Service-Specific Changes
- Changes to `services/personal-email-signup-backend/` → Runs signup service CI
- Changes to `services/login-page-back/` → Runs login service CI
- Changes to `src/` or `scripts/` → Runs all service CIs

#### Shared Dependencies
When modifying shared components in `src/`, all dependent services are tested automatically.

### Dependency Management

#### Adding Dependencies
```bash
# Service-specific dependencies
cd services/service-name
npm install new-package

# Shared dependencies (careful consideration required)
npm install --workspace=root shared-package
```

#### Updating Dependencies
```bash
# Check outdated packages
npm outdated

# Update with caution and test thoroughly
npm update

# For major version updates, create dedicated PR
```

### Performance Considerations

#### Database Optimization
- Use indexes for frequently queried columns
- Implement connection pooling
- Monitor query performance

#### Caching Strategy
- Use Redis for session storage
- Cache frequently accessed data
- Implement cache invalidation strategies

#### Monitoring
- Application metrics via Prometheus
- Logging via Winston
- Error tracking via Sentry (if configured)

---

**Need Help?** 

- 💬 **Slack**: #engineering-help
- 📧 **Email**: engineering@company.com  
- 📚 **Docs**: [Full Documentation](./docs/)
- 🎥 **Onboarding**: [Video Tutorials](./docs/onboarding/)

---

*This document is living documentation. Please keep it updated as processes evolve.*

**Last Updated**: 7 February 2026  
**Document Owner**: @org/tech-docs
