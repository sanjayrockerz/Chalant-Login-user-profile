# Push Token System - Testing Documentation

## Overview

This document provides comprehensive testing information for the push token management system, including test coverage, scenarios, and execution instructions.

## Test Structure

```
src/push-tokens/tests/
├── setup.ts                                    # Global test setup and mocks
├── push-token.service.integration.spec.ts     # Service layer integration tests  
├── push-token.controller.integration.spec.ts  # Controller layer integration tests
└── README.md                                   # This documentation
```

## Test Categories

### 1. Integration Tests

#### Service Layer Tests (`push-token.service.integration.spec.ts`)
- **Token Registration**: FCM/APNs token registration with validation
- **Token Listing & Retrieval**: Pagination, filtering, caching integration
- **Token Updates**: Metadata updates, status changes, validation
- **Token Deletion**: Soft deletion with audit trails
- **Token Validation**: Platform-specific validation with caching
- **Token Cleanup**: Automated cleanup of invalid/expired tokens
- **Cache Integration**: Redis caching behavior and invalidation
- **Observability Integration**: Metrics recording and tracing
- **Multi-device Scenarios**: Multiple devices per user management

#### Controller Layer Tests (`push-token.controller.integration.spec.ts`)
- **REST API Endpoints**: HTTP request/response validation
- **Input Validation**: DTO validation and error handling
- **Authentication**: Header validation and user context
- **Error Handling**: Proper HTTP status codes and error responses
- **Pagination**: Query parameter validation and response structure
- **Bulk Operations**: Token validation and cleanup endpoints

## Test Scenarios

### Core Functionality Tests

1. **Token Registration**
   - ✅ Register new FCM token successfully
   - ✅ Register new APNs token successfully  
   - ✅ Update existing token when re-registering
   - ✅ Reject invalid token format
   - ✅ Reject mismatched platform and token type
   - ✅ Handle device metadata properly

2. **Token Management**
   - ✅ List user tokens with pagination
   - ✅ Filter tokens by platform and status
   - ✅ Update token metadata and status
   - ✅ Soft delete tokens with audit trail
   - ✅ Cache token operations properly

3. **Token Validation**
   - ✅ Validate multiple tokens in batch
   - ✅ Use cached validation results
   - ✅ Platform-specific validation logic
   - ✅ Handle validation failures gracefully

4. **System Operations**
   - ✅ Cleanup invalid tokens automatically
   - ✅ Maintain audit trails for all operations
   - ✅ Record metrics and observability data
   - ✅ Handle multi-device scenarios

### Edge Cases & Error Handling

1. **Input Validation**
   - ✅ Invalid token formats
   - ✅ Missing required fields
   - ✅ Platform/token type mismatches
   - ✅ Invalid pagination parameters

2. **Business Logic**
   - ✅ Duplicate token prevention
   - ✅ Non-existent token handling
   - ✅ Authorization validation
   - ✅ Concurrent operation handling

3. **Infrastructure**
   - ✅ Database connection failures
   - ✅ Redis cache unavailability
   - ✅ External service timeouts
   - ✅ Transaction rollback scenarios

### Performance & Scale

1. **Caching Strategy**
   - ✅ Cache hit/miss behavior
   - ✅ Cache invalidation patterns
   - ✅ TTL management
   - ✅ Memory usage optimization

2. **Database Operations**
   - ✅ Query optimization
   - ✅ Index usage validation
   - ✅ Bulk operation efficiency
   - ✅ Connection pooling

3. **Observability**
   - ✅ Metrics collection accuracy
   - ✅ Tracing span creation
   - ✅ Log structured format
   - ✅ Performance monitoring

## Mock Strategy

### External Dependencies

1. **Database (TypeORM)**
   - Mock repositories and query builders
   - Simulate entity relationships
   - Mock transaction handling
   - Test error scenarios

2. **Redis Cache**
   - Mock cache operations (get/set/del)
   - Simulate cache miss scenarios
   - Test pipeline operations
   - Mock connection failures

3. **Observability**
   - Mock Prometheus metrics
   - Mock OpenTelemetry tracing
   - Test metric recording
   - Validate span creation

### Test Data

1. **Valid Tokens**
   - FCM: 152-character token starting with 'f'
   - APNs: 64-character hexadecimal token

2. **Device Metadata**
   - Platform-specific device information
   - App version and OS details
   - Locale and timezone data

3. **User Context**
   - Mock user IDs and tenant IDs
   - Correlation IDs for tracing
   - Authentication headers

## Running Tests

### Prerequisites

```bash
# Install dependencies
npm install

# Ensure TypeScript compilation
npx tsc --noEmit
```

### Test Execution

```bash
# Run all tests
./src/push-tokens/run-tests.sh

# Run specific test suites
npx jest --config=src/push-tokens/jest.config.json

# Run with coverage
npx jest --config=src/push-tokens/jest.config.json --coverage

# Run specific test file
npx jest src/push-tokens/tests/push-token.service.integration.spec.ts

# Run in watch mode
npx jest --config=src/push-tokens/jest.config.json --watch
```

### Environment Setup

1. **Test Environment Variables**
   ```bash
   NODE_ENV=test
   REDIS_URL=redis://localhost:6379
   DATABASE_URL=postgresql://test:test@localhost:5432/test
   ```

2. **Docker Services (Optional)**
   ```bash
   # Start test database
   docker run -d --name test-postgres \
     -e POSTGRES_USER=test \
     -e POSTGRES_PASSWORD=test \
     -e POSTGRES_DB=test \
     -p 5432:5432 postgres:14

   # Start test Redis
   docker run -d --name test-redis \
     -p 6379:6379 redis:7-alpine
   ```

## Test Configuration

### Jest Configuration (`jest.config.json`)

```json
{
  "displayName": "Push Token Tests",
  "testMatch": ["**/push-tokens/**/*.spec.ts"],
  "transform": {"^.+\\.(t|j)s$": "ts-jest"},
  "collectCoverageFrom": ["src/push-tokens/**/*.(t|j)s"],
  "testEnvironment": "node",
  "setupFilesAfterEnv": ["<rootDir>/src/push-tokens/tests/setup.ts"]
}
```

### Coverage Requirements

- **Statements**: > 85%
- **Branches**: > 80%
- **Functions**: > 90%
- **Lines**: > 85%

## Continuous Integration

### GitHub Actions Integration

```yaml
# .github/workflows/push-tokens-tests.yml
name: Push Token Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7-alpine
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      - run: npm ci
      - run: ./src/push-tokens/run-tests.sh
```

## Test Maintenance

### Adding New Tests

1. **Service Tests**: Add to `push-token.service.integration.spec.ts`
2. **Controller Tests**: Add to `push-token.controller.integration.spec.ts`
3. **Follow naming convention**: `describe('Feature') > it('should behavior')`
4. **Use proper mocking**: Mock external dependencies, use real business logic

### Updating Tests

1. **When adding new features**: Add corresponding test cases
2. **When fixing bugs**: Add regression tests
3. **When changing APIs**: Update integration tests
4. **When optimizing**: Add performance benchmarks

### Test Data Management

1. **Use factories**: Create helper functions for test data
2. **Avoid hardcoding**: Use constants and configuration
3. **Clean up**: Ensure tests don't affect each other
4. **Realistic data**: Use data that matches production patterns

## Troubleshooting

### Common Issues

1. **TypeScript Compilation Errors**
   - Check import paths and type definitions
   - Ensure all dependencies are installed
   - Verify tsconfig.json configuration

2. **Mock Setup Issues**
   - Check setup.ts for proper mocking
   - Ensure mocks match actual service interfaces
   - Verify mock return values match expected types

3. **Test Timeouts**
   - Increase Jest timeout for slow operations
   - Check for unresolved promises
   - Ensure proper async/await usage

4. **Database Connection Issues**
   - Verify test database is running
   - Check connection string format
   - Ensure proper cleanup after tests

### Debug Commands

```bash
# Run with debug output
DEBUG=* npx jest --config=src/push-tokens/jest.config.json

# Run single test with verbose output
npx jest --config=src/push-tokens/jest.config.json --testNamePattern="should register" --verbose

# Check coverage details
npx jest --config=src/push-tokens/jest.config.json --coverage --coverageReporters=text-lcov
```

## Performance Benchmarks

### Target Metrics

1. **Token Registration**: < 100ms (95th percentile)
2. **Token Listing**: < 50ms (95th percentile)
3. **Cache Operations**: < 10ms (95th percentile)
4. **Validation**: < 200ms per token (95th percentile)

### Load Testing

```bash
# Example load test (requires additional setup)
npm run test:load -- --duration=60s --rate=100rps
```

## Security Testing

### Test Coverage

1. **Input Validation**: All user inputs properly validated
2. **Authentication**: User context properly enforced
3. **Authorization**: User can only access own tokens
4. **Data Sanitization**: No injection vulnerabilities
5. **Rate Limiting**: Proper throttling mechanisms

### Security Test Examples

```typescript
// Example security test
it('should prevent access to other user tokens', async () => {
  const otherUserToken = await createTokenForUser('other-user');
  
  await request(app.getHttpServer())
    .get(`/push-tokens/${otherUserToken.id}`)
    .set('x-user-id', 'current-user')
    .expect(404); // or 403 Forbidden
});
```

## Conclusion

This comprehensive test suite ensures the push token management system is reliable, performant, and secure. Regular test execution and maintenance are crucial for system stability and feature development confidence.

For questions or improvements, please refer to the main project documentation or create an issue in the repository.