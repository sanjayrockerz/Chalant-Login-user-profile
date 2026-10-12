# Personal Email Signup Backend

A NestJS-based authentication service that handles user registration, email verification, and account management for the auth services monorepo.

## 🏗️ Service Overview

### Purpose
This service manages the complete user signup journey, from initial registration through email verification and account activation.

### Key Features
- **User Registration**: Account creation with email validation
- **OTP Verification**: Secure email verification using one-time passwords
- **Password Management**: Secure password hashing and reset workflows
- **Profile Management**: User profile creation and updates
- **Email Notifications**: Automated email communications
- **Rate Limiting**: Protection against abuse and spam

### Technology Stack
- **Framework**: NestJS (Node.js framework)
- **Language**: TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Cache**: Redis for OTP storage and session management
- **Authentication**: JWT tokens with bcrypt password hashing
- **Email**: Nodemailer with configurable providers
- **Validation**: Class-validator and Zod schemas
- **Testing**: Jest with comprehensive test suites
- **Monitoring**: Winston logging and Prometheus metrics

---

## 🚀 Quick Start

### Prerequisites
- Node.js v18+ 
- PostgreSQL v14+
- Redis v6+
- npm v9+

### Local Development Setup

#### 1. Install Dependencies
```bash
cd services/personal-email-signup-backend
npm install
```

#### 2. Environment Configuration
```bash
# Copy environment template
cp .env.example .env

# Configure environment variables
nano .env
```

#### 3. Database Setup
```bash
# Run database migrations
npm run migration:deploy

# Seed development data (optional)
npm run db:seed

# Open Prisma Studio (database GUI)
npm run db:studio
```

#### 4. Start Development Server
```bash
# Development mode with hot reload
npm run start:dev

# Debug mode
npm run start:debug

# Production mode
npm run start:prod
```

The service will be available at `http://localhost:3000`

---

## 📋 Environment Variables

### Required Configuration

```bash
# Server Configuration
NODE_ENV=development|staging|production
PORT=3000
LOG_LEVEL=debug|info|warn|error

# Database Configuration
DATABASE_URL=postgresql://username:password@localhost:5432/signup_db
REDIS_URL=redis://localhost:6379

# Authentication Configuration
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRY=7d
BCRYPT_ROUNDS=12

# Email Configuration
EMAIL_FROM=noreply@yourcompany.com
EMAIL_SERVICE=sendgrid|ses|smtp

# SendGrid (if using)
SENDGRID_API_KEY=your-sendgrid-key

# SMTP (if using)
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password

# OTP Configuration
OTP_LENGTH=6
OTP_EXPIRY=300  # 5 minutes in seconds
OTP_MAX_ATTEMPTS=3

# Rate Limiting
RATE_LIMIT_WINDOW=15  # minutes
RATE_LIMIT_MAX=100    # requests per window

# Monitoring (optional)
PROMETHEUS_ENABLED=true
SENTRY_DSN=your-sentry-dsn
```

### Development vs Production

#### Development (.env.development)
```bash
NODE_ENV=development
LOG_LEVEL=debug
DATABASE_URL=postgresql://dev:dev@localhost:5432/signup_dev
REDIS_URL=redis://localhost:6379/0
JWT_SECRET=dev-secret-key
```

#### Production (.env.production)
```bash
NODE_ENV=production
LOG_LEVEL=info
DATABASE_URL=postgresql://user:pass@prod-db:5432/signup_prod
REDIS_URL=redis://prod-redis:6379/0
JWT_SECRET=${JWT_SECRET}  # From secrets manager
```

---

## 🗄️ Database Schema

### Core Tables

#### Users Table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  email_verified BOOLEAN DEFAULT FALSE,
  email_verified_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);
```

#### Email Verifications Table
```sql
CREATE TABLE email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  email VARCHAR(255) NOT NULL,
  otp_code VARCHAR(10) NOT NULL,
  attempts INT DEFAULT 0,
  expires_at TIMESTAMP NOT NULL,
  verified_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### Password Resets Table
```sql
CREATE TABLE password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  reset_token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Database Operations

#### Migrations
```bash
# Generate new migration
npm run migration:generate -- --name add_new_field

# Deploy migrations
npm run migration:deploy

# Reset database (development only)
npm run migration:reset

# Check migration status
npm run migration:status
```

#### Seeding
```bash
# Seed development data
npm run db:seed

# Seed specific data
npm run db:seed -- --data=users

# Clear database
npm run db:clear
```

---

## 🔌 API Documentation

### Base URL
```
Development: http://localhost:3000
Staging: https://signup-api-staging.company.com
Production: https://signup-api.company.com
```

### Authentication
Most endpoints require JWT token in Authorization header:
```
Authorization: Bearer <jwt_token>
```

### Core Endpoints

#### POST /auth/signup
Register a new user account.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Registration successful. Please verify your email.",
  "data": {
    "userId": "123e4567-e89b-12d3-a456-426614174000",
    "email": "user@example.com",
    "verificationRequired": true
  }
}
```

#### POST /auth/verify-email
Verify email address with OTP.

**Request:**
```json
{
  "email": "user@example.com",
  "otpCode": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Email verified successfully",
  "data": {
    "userId": "123e4567-e89b-12d3-a456-426614174000",
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 604800
  }
}
```

#### POST /auth/resend-verification
Resend email verification OTP.

**Request:**
```json
{
  "email": "user@example.com"
}
```

#### POST /auth/forgot-password
Initiate password reset flow.

**Request:**
```json
{
  "email": "user@example.com"
}
```

#### POST /auth/reset-password
Complete password reset with token.

**Request:**
```json
{
  "resetToken": "abc123def456",
  "newPassword": "NewSecurePassword123!"
}
```

#### GET /users/profile
Get current user profile (requires authentication).

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "emailVerified": true,
    "createdAt": "2025-10-10T10:00:00.000Z"
  }
}
```

#### PUT /users/profile
Update user profile (requires authentication).

**Request:**
```json
{
  "firstName": "Jane",
  "lastName": "Smith"
}
```

### Error Responses

All errors follow consistent format:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ]
  },
  "timestamp": "2025-10-10T10:00:00.000Z",
  "path": "/auth/signup"
}
```

### API Documentation UI
Interactive API documentation available at:
- Development: http://localhost:3000/api/docs
- Staging: https://signup-api-staging.company.com/api/docs

---

## 🧪 Testing

### Test Types

#### Unit Tests
```bash
# Run all unit tests
npm run test

# Run specific test file
npm run test -- auth.service.spec.ts

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:cov
```

#### Integration Tests
```bash
# Run integration tests
npm run test:integration

# Run specific integration test
npm run test:integration -- auth.integration.spec.ts
```

#### End-to-End Tests
```bash
# Run e2e tests
npm run test:e2e

# Run specific e2e test
npm run test:e2e -- signup.e2e-spec.ts
```

#### Contract Tests
```bash
# Run contract tests
npm run test:contract

# Generate contract documentation
npm run contract:docs
```

### Test Configuration

#### Test Database
Tests use separate database configuration:
```bash
# Test environment variables
DATABASE_URL=postgresql://test:test@localhost:5433/signup_test
REDIS_URL=redis://localhost:6379/1
```

#### Test Setup
```bash
# Set up test environment
npm run test:setup

# Clean up after tests
npm run test:cleanup

# Reset test data
npm run test:reset
```

### Coverage Requirements
- **Minimum**: 80% overall coverage
- **Statements**: 85%
- **Branches**: 80%
- **Functions**: 90%
- **Lines**: 85%

---

## 🔧 Development

### Available Scripts

```bash
# Development
npm run start:dev          # Start with hot reload
npm run start:debug        # Start in debug mode

# Building
npm run build              # Build for production
npm run build:watch        # Build in watch mode

# Code Quality
npm run lint               # Run ESLint
npm run lint:fix           # Fix ESLint issues
npm run format             # Format with Prettier
npm run type-check         # TypeScript type checking

# Database
npm run migration:generate # Generate new migration
npm run migration:deploy   # Run migrations
npm run migration:reset    # Reset database
npm run db:seed           # Seed database
npm run db:studio         # Open Prisma Studio

# Testing
npm run test              # Unit tests
npm run test:watch        # Tests in watch mode
npm run test:cov          # Coverage report
npm run test:integration  # Integration tests
npm run test:e2e          # End-to-end tests
npm run test:all          # All test suites

# Security
npm run secrets:scan      # Scan for secrets
npm audit                 # Check dependencies

# Production
npm run start:prod        # Start production server
```

### Code Architecture

#### Project Structure
```
src/
├── auth/                 # Authentication module
│   ├── controllers/      # API endpoints
│   ├── services/         # Business logic
│   ├── dto/             # Data transfer objects
│   ├── guards/          # Auth guards
│   └── strategies/      # Passport strategies
├── users/               # User management module
├── email/               # Email service module
├── common/              # Shared utilities
│   ├── decorators/      # Custom decorators
│   ├── filters/         # Exception filters
│   ├── guards/          # Common guards
│   ├── interceptors/    # Request/response interceptors
│   └── pipes/           # Validation pipes
├── config/              # Configuration
└── database/            # Database configuration
```

#### Module Organization
- **AuthModule**: Handles signup, verification, password reset
- **UsersModule**: User profile management
- **EmailModule**: Email notifications and templates
- **DatabaseModule**: Prisma ORM configuration
- **ConfigModule**: Environment and configuration management

### Development Guidelines

#### Code Style
- Use TypeScript for all code
- Follow NestJS conventions and patterns
- Use dependency injection
- Implement proper error handling
- Add comprehensive logging

#### Security Best Practices
- Validate all inputs with DTOs
- Hash passwords with bcrypt
- Use JWT with appropriate expiration
- Implement rate limiting
- Sanitize all outputs
- Never log sensitive information

#### Performance Considerations
- Use database indexes effectively
- Implement caching with Redis
- Optimize database queries
- Use connection pooling
- Monitor memory usage

---

## 🚀 Deployment

### Docker Support

#### Development
```bash
# Build development image
docker build -f Dockerfile.dev -t signup-backend:dev .

# Run with docker-compose
docker-compose up signup-backend
```

#### Production
```bash
# Build production image
docker build -t signup-backend:prod .

# Run production container
docker run -p 3000:3000 \
  -e DATABASE_URL=$DATABASE_URL \
  -e REDIS_URL=$REDIS_URL \
  signup-backend:prod
```

### Environment Deployment

#### Staging
- Automatic deployment on merge to `main`
- Database migrations run automatically
- Health checks verify deployment

#### Production
- Manual deployment via tagged releases
- Requires approval from maintainers
- Blue-green deployment strategy
- Comprehensive monitoring

### Health Checks

#### Endpoints
- `GET /health` - Basic health check
- `GET /health/detailed` - Detailed system status
- `GET /health/db` - Database connectivity
- `GET /health/redis` - Redis connectivity

#### Monitoring
- **Metrics**: Prometheus metrics at `/metrics`
- **Logs**: Structured JSON logging with Winston
- **Tracing**: OpenTelemetry integration (if enabled)

---

## 🐛 Troubleshooting

### Common Issues

#### Database Connection
```bash
# Test database connection
npm run db:status

# Check database URL format
echo $DATABASE_URL

# Reset database schema
npm run migration:reset
npm run migration:deploy
```

#### Redis Connection
```bash
# Test Redis connection
redis-cli -u $REDIS_URL ping

# Clear Redis cache
redis-cli -u $REDIS_URL flushall
```

#### Email Service
```bash
# Test email configuration
npm run email:test

# Check email service logs
npm run logs -- --service=email
```

#### OTP Issues
```bash
# Check OTP configuration
npm run config:validate

# Clear OTP cache
redis-cli -u $REDIS_URL del "otp:*"
```

### Performance Issues

#### Database Performance
```bash
# Analyze slow queries
npm run db:analyze

# Check query performance
npm run db:explain -- "SELECT * FROM users WHERE email = ?"
```

#### Memory Issues
```bash
# Check memory usage
npm run metrics:memory

# Generate heap dump
npm run debug:heap-dump
```

### Debugging

#### Debug Mode
```bash
# Start in debug mode
npm run start:debug

# Attach debugger (VS Code)
# Use "Attach to Node" configuration
```

#### Logging
```bash
# Increase log level
LOG_LEVEL=debug npm run start:dev

# View specific logs
npm run logs -- --level=error
npm run logs -- --module=auth
```

---

## 📚 Additional Resources

### Documentation
- [NestJS Documentation](https://docs.nestjs.com/)
- [Prisma Documentation](https://www.prisma.io/docs/)
- [Redis Documentation](https://redis.io/documentation)

### Team Resources
- **Code Reviews**: Use GitHub PR template
- **Issues**: Report via GitHub Issues
- **Discussions**: #backend-team Slack channel
- **On-Call**: @signup-oncall

### External Dependencies
- **Email Service**: SendGrid/AWS SES
- **Monitoring**: Prometheus + Grafana
- **Error Tracking**: Sentry (if configured)
- **Secret Management**: AWS Secrets Manager/Vault

---

## 📞 Support

### Team Contacts
- **Service Owner**: @org/identity-platform
- **Primary Maintainer**: @signup-team-lead
- **On-Call Engineer**: @signup-oncall
- **Backend Team**: @org/platform-core

### Communication Channels
- **Slack**: #signup-team
- **Email**: signup@company.com
- **Emergency**: @signup-oncall
- **General**: #backend-team

---

**Service Version**: 0.0.1  
**Last Updated**: 7 February 2026  
**Service Owner**: @org/identity-platform