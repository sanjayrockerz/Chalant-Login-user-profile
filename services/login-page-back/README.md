# Login Page Backend

An authentication service that handles user login, session management, and OAuth integration for the auth services monorepo. This service uses an adaptive build system supporting multiple frameworks and deployment strategies.

## 🏗️ Service Overview

### Purpose
This service manages user authentication, session handling, and provides secure login functionality with support for multiple authentication providers.

### Key Features
- **User Authentication**: Secure login with JWT tokens
- **Session Management**: Server-side session handling
- **OAuth Integration**: Support for Google, GitHub, and other providers
- **Multi-Factor Authentication**: Optional 2FA support
- **Session Security**: Advanced session protection and monitoring
- **Adaptive Architecture**: Supports multiple build systems and frameworks

### Technology Stack
- **Framework**: Express.js or NestJS (adaptive detection)
- **Language**: JavaScript/TypeScript (auto-detected)
- **Database**: PostgreSQL or MongoDB (configurable)
- **Session Store**: Redis or in-memory (configurable)
- **Authentication**: JWT + OAuth 2.0
- **Build System**: Adaptive (npm, Docker, Make, or custom)

---

## 🚀 Quick Start

### Prerequisites
- Node.js v16+ (if using npm)
- Docker (if using containerized build)
- Database (PostgreSQL/MongoDB)
- Redis (recommended for sessions)

### Build System Detection

This service automatically detects and adapts to different build systems:

#### 1. Check Build System
```bash
cd services/login-page-back

# The service will auto-detect the build system:
ls -la  # Look for package.json, Dockerfile, Makefile, or custom scripts
```

#### 2. Node.js/npm Setup
```bash
# If package.json exists
npm install
npm run start:dev
```

#### 3. Docker Setup
```bash
# If Dockerfile exists
docker build -t login-backend .
docker run -p 3000:3000 login-backend
```

#### 4. Make Setup
```bash
# If Makefile exists
make install
make dev
```

#### 5. Custom Build System
```bash
# Check for custom scripts
ls scripts/
./scripts/setup.sh
./scripts/start.sh
```

---

## 📋 Configuration

### Environment Variables

#### Core Configuration
```bash
# Server Configuration
NODE_ENV=development|staging|production
PORT=3001
SERVICE_NAME=login-page-back

# Database Configuration (choose one)
DATABASE_URL=postgresql://user:pass@localhost:5432/login_db
# OR
MONGODB_URL=mongodb://localhost:27017/login_db

# Session Configuration
SESSION_SECRET=your-session-secret
SESSION_STORE=redis|memory
REDIS_URL=redis://localhost:6379

# Authentication Configuration
JWT_SECRET=your-jwt-secret
JWT_EXPIRY=24h
COOKIE_SECURE=true  # Set to false for development

# OAuth Configuration
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# Security Configuration
BCRYPT_ROUNDS=12
RATE_LIMIT_WINDOW=15  # minutes
RATE_LIMIT_MAX=100    # requests per window
```

#### Framework-Specific Variables

##### For Express.js
```bash
EXPRESS_PORT=3001
EXPRESS_HOST=0.0.0.0
CORS_ORIGIN=http://localhost:3000
```

##### For NestJS
```bash
NESTJS_PORT=3001
NESTJS_GLOBAL_PREFIX=api
SWAGGER_ENABLED=true
```

### Configuration Files

#### package.json (if using npm)
```json
{
  "name": "login-page-back",
  "version": "1.0.0",
  "scripts": {
    "start": "node dist/main.js",
    "start:dev": "nodemon src/main.js",
    "build": "tsc",
    "test": "jest"
  }
}
```

#### docker-compose.yml (if using Docker)
```yaml
version: '3.8'
services:
  login-backend:
    build: .
    ports:
      - "3001:3001"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
    depends_on:
      - postgres
      - redis
```

---

## 🗄️ Database Schema

### User Authentication Tables

#### Users Table
```sql
-- PostgreSQL Schema
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  username VARCHAR(100) UNIQUE,
  provider VARCHAR(50) DEFAULT 'local',
  provider_id VARCHAR(255),
  email_verified BOOLEAN DEFAULT FALSE,
  two_factor_enabled BOOLEAN DEFAULT FALSE,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### Sessions Table
```sql
-- Session storage (if not using Redis)
CREATE TABLE sessions (
  id VARCHAR(128) PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  session_data JSONB NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### OAuth Providers Table
```sql
CREATE TABLE oauth_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  provider VARCHAR(50) NOT NULL,
  provider_id VARCHAR(255) NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(provider, provider_id)
);
```

### MongoDB Schema (Alternative)

```javascript
// User Collection
{
  _id: ObjectId,
  email: String,
  passwordHash: String,
  username: String,
  provider: String,
  providerId: String,
  emailVerified: Boolean,
  twoFactorEnabled: Boolean,
  lastLogin: Date,
  createdAt: Date,
  updatedAt: Date
}

// Session Collection
{
  _id: String, // session ID
  userId: ObjectId,
  sessionData: Object,
  expiresAt: Date,
  createdAt: Date
}
```

---

## 🔌 API Documentation

### Base URL
```
Development: http://localhost:3001
Staging: https://login-api-staging.company.com
Production: https://login-api.company.com
```

### Authentication Endpoints

#### POST /auth/login
Authenticate user with email/password.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "rememberMe": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "email": "user@example.com",
      "username": "johndoe"
    },
    "expiresIn": 86400
  }
}
```

#### POST /auth/logout
Logout user and invalidate session.

**Request:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### POST /auth/refresh
Refresh access token.

**Request:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### GET /auth/me
Get current authenticated user (requires JWT).

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "email": "user@example.com",
    "username": "johndoe",
    "emailVerified": true,
    "twoFactorEnabled": false,
    "lastLogin": "2025-10-10T10:00:00.000Z"
  }
}
```

### OAuth Endpoints

#### GET /auth/oauth/:provider
Initiate OAuth flow (Google, GitHub, etc.).

**Example:**
```
GET /auth/oauth/google
GET /auth/oauth/github
```

#### GET /auth/oauth/:provider/callback
OAuth callback endpoint.

**Query Parameters:**
```
?code=oauth_authorization_code&state=random_state
```

### Session Management

#### GET /auth/sessions
List active sessions (requires authentication).

#### DELETE /auth/sessions/:id
Revoke specific session.

#### DELETE /auth/sessions/all
Revoke all sessions except current.

---

## 🧪 Testing

### Adaptive Test Runner

The service detects and runs appropriate tests based on the build system:

#### npm/Node.js Testing
```bash
# If package.json exists
npm test
npm run test:integration
npm run test:e2e
```

#### Docker Testing
```bash
# If Dockerfile.test exists
docker build -f Dockerfile.test -t login-backend:test .
docker run login-backend:test
```

#### Make Testing
```bash
# If Makefile with test targets
make test
make test-integration
make test-coverage
```

#### Custom Testing
```bash
# Check for custom test scripts
./scripts/test.sh
./test/run-tests.sh
```

### Test Configuration

#### Unit Tests
```bash
# Test authentication logic
npm run test -- auth.test.js

# Test OAuth integration
npm run test -- oauth.test.js

# Test session management
npm run test -- session.test.js
```

#### Integration Tests
```bash
# Test full login flow
npm run test:integration -- login-flow.test.js

# Test OAuth providers
npm run test:integration -- oauth-providers.test.js
```

#### Security Tests
```bash
# Test authentication security
npm run test:security

# Test session security
npm run test:security -- session-security.test.js
```

---

## 🔧 Development

### Build System Adaptation

#### Detecting Build System
The service automatically detects the build system during startup:

```bash
#!/bin/bash
# Auto-detection script

if [[ -f "package.json" ]]; then
  echo "Detected: Node.js/npm build system"
  npm install && npm run start:dev
elif [[ -f "Dockerfile" ]]; then
  echo "Detected: Docker build system"
  docker build -t login-backend . && docker run -p 3001:3001 login-backend
elif [[ -f "Makefile" ]]; then
  echo "Detected: Make build system"
  make install && make dev
elif [[ -f "scripts/start.sh" ]]; then
  echo "Detected: Custom build system"
  ./scripts/setup.sh && ./scripts/start.sh
else
  echo "No recognized build system found"
  exit 1
fi
```

### Development Scripts

#### Node.js/npm Scripts
```json
{
  "scripts": {
    "start": "node dist/main.js",
    "start:dev": "nodemon --exec babel-node src/main.js",
    "start:debug": "node --inspect-brk dist/main.js",
    "build": "babel src -d dist",
    "build:tsc": "tsc",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:integration": "jest --testPathPattern=integration",
    "lint": "eslint src/",
    "format": "prettier --write src/"
  }
}
```

#### Docker Scripts
```bash
# Development
docker-compose -f docker-compose.dev.yml up

# Production
docker-compose -f docker-compose.prod.yml up

# Testing
docker-compose -f docker-compose.test.yml up --abort-on-container-exit
```

#### Make Targets
```makefile
# Makefile
.PHONY: install dev build test clean

install:
	@echo "Installing dependencies..."
	npm install || yarn install || echo "Manual dependency installation required"

dev:
	@echo "Starting development server..."
	npm run start:dev || yarn dev || node src/main.js

build:
	@echo "Building application..."
	npm run build || yarn build || echo "Manual build required"

test:
	@echo "Running tests..."
	npm test || yarn test || echo "Manual testing required"

clean:
	@echo "Cleaning build artifacts..."
	rm -rf dist/ node_modules/ .cache/
```

### Framework-Specific Development

#### Express.js Development
```javascript
// src/app.js
const express = require('express');
const session = require('express-session');
const passport = require('passport');

const app = express();

// Middleware configuration
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/api', require('./routes/api'));

module.exports = app;
```

#### NestJS Development
```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Global configuration
  app.setGlobalPrefix('api');
  app.enableCors();
  
  await app.listen(process.env.PORT || 3001);
}
bootstrap();
```

---

## 🚀 Deployment

### Adaptive Deployment

#### Docker Deployment
```yaml
# docker-compose.yml
version: '3.8'
services:
  login-backend:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
    depends_on:
      - postgres
      - redis
    restart: unless-stopped
```

#### Traditional Deployment
```bash
# PM2 process manager
pm2 start ecosystem.config.js

# Systemd service
sudo systemctl start login-backend
sudo systemctl enable login-backend
```

#### Cloud Deployment
```bash
# AWS Elastic Beanstalk
eb init login-backend
eb create production-env

# Google Cloud Run
gcloud run deploy login-backend --source .

# Azure Container Apps
az containerapp create --name login-backend --resource-group myRG
```

### Environment-Specific Configuration

#### Development
```bash
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://dev:dev@localhost:5432/login_dev
REDIS_URL=redis://localhost:6379/0
```

#### Staging
```bash
NODE_ENV=staging
PORT=3001
DATABASE_URL=postgresql://staging:pass@staging-db:5432/login_staging
REDIS_URL=redis://staging-redis:6379/0
```

#### Production
```bash
NODE_ENV=production
PORT=3001
DATABASE_URL=${DATABASE_URL}  # From secrets manager
REDIS_URL=${REDIS_URL}        # From secrets manager
```

---

## 🔐 Security

### Authentication Security

#### Password Security
- **Hashing**: bcrypt with configurable rounds
- **Complexity**: Enforced password strength requirements
- **Brute Force Protection**: Rate limiting and account lockout

#### JWT Security
- **Secret Management**: Environment-based secrets
- **Token Expiration**: Configurable expiry times
- **Refresh Tokens**: Secure token rotation
- **Blacklisting**: Token revocation support

#### Session Security
- **Secure Cookies**: HTTPOnly, Secure, SameSite settings
- **Session Rotation**: Automatic session ID rotation
- **Timeout**: Configurable session timeouts
- **Storage**: Redis-based secure session storage

### OAuth Security

#### Provider Configuration
```javascript
// OAuth security configuration
const oauthConfig = {
  google: {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/auth/oauth/google/callback',
    scope: ['profile', 'email']
  },
  github: {
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: '/auth/oauth/github/callback',
    scope: ['user:email']
  }
};
```

#### State Validation
- **CSRF Protection**: State parameter validation
- **Nonce Verification**: Prevent replay attacks
- **Redirect Validation**: Whitelist callback URLs

---

## 🐛 Troubleshooting

### Build System Issues

#### Unknown Build System
```bash
# Create basic package.json if none exists
npm init -y

# Add basic scripts
npm pkg set scripts.start="node src/main.js"
npm pkg set scripts.dev="nodemon src/main.js"
npm pkg set scripts.test="echo 'Tests not configured'"
```

#### Docker Issues
```bash
# Check Docker configuration
docker info

# Build with verbose output
docker build --no-cache -t login-backend .

# Check container logs
docker logs login-backend
```

#### Make Issues
```bash
# Validate Makefile syntax
make -n install

# Check available targets
make help
```

### Database Connection Issues

#### PostgreSQL
```bash
# Test connection
psql $DATABASE_URL -c "SELECT 1;"

# Check connection pool
npm run db:status
```

#### MongoDB
```bash
# Test connection
mongo $MONGODB_URL --eval "db.runCommand('ping')"

# Check database status
npm run db:status
```

### Redis Issues
```bash
# Test Redis connection
redis-cli -u $REDIS_URL ping

# Check session storage
redis-cli -u $REDIS_URL keys "sess:*"
```

### OAuth Issues

#### Provider Configuration
```bash
# Validate OAuth configuration
npm run config:validate

# Test OAuth flow
curl -X GET "http://localhost:3001/auth/oauth/google"
```

#### Callback Issues
- Verify callback URLs in provider settings
- Check state parameter validation
- Ensure HTTPS in production

---

## 📚 Additional Resources

### Framework Documentation
- **Express.js**: https://expressjs.com/
- **NestJS**: https://docs.nestjs.com/
- **Passport.js**: http://www.passportjs.org/

### OAuth Providers
- **Google OAuth**: https://developers.google.com/identity/protocols/oauth2
- **GitHub OAuth**: https://docs.github.com/en/developers/apps/building-oauth-apps

### Security Resources
- **OWASP Authentication**: https://owasp.org/www-project-authentication-cheat-sheet/
- **JWT Best Practices**: https://tools.ietf.org/html/rfc8725

---

## 📞 Support

### Team Contacts
- **Service Owner**: @org/session-platform
- **Primary Maintainer**: @auth-team-lead
- **On-Call Engineer**: @auth-oncall
- **Backend Team**: @org/platform-core

### Communication Channels
- **Slack**: #auth-team
- **Email**: auth@company.com
- **Emergency**: @auth-oncall
- **General**: #backend-team

### Issue Reporting
- **GitHub Issues**: For bugs and feature requests
- **Security Issues**: security@company.com
- **Production Issues**: @auth-oncall

---

**Service Version**: 1.0.0  
**Last Updated**: 7 February 2026  
**Service Owner**: @org/session-platform