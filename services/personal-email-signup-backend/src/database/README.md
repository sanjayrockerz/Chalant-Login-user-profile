# Database Module

## Overview

The database module provides Prisma ORM integration and database access patterns for the signup backend service.

## Features

- **Prisma Client**: Type-safe database client
- **Connection Pooling**: Optimized connection management
- **Transaction Support**: ACID transactions with rollback
- **Migration Management**: Schema versioning and deployment
- **Query Optimization**: Indexes and query performance tools

## Architecture

```
src/database/
├── prisma/
│   ├── schema.prisma        # Database schema
│   └── migrations/          # Migration files
├── database.module.ts       # NestJS module
├── database.service.ts      # Connection and query service
└── repositories/            # Repository pattern implementations
    ├── user.repository.ts
    └── base.repository.ts
```

## Usage

### Import Module

```typescript
// app.module.ts
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [DatabaseModule],
  // ...
})
export class AppModule {}
```

### Inject Prisma Client

```typescript
// user.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from './database/database.service';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email }
    });
  }
}
```

### Using Transactions

```typescript
async createUserWithProfile(email: string, profileData: any) {
  return this.prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email }
    });
    
    const profile = await tx.profile.create({
      data: { ...profileData, userId: user.id }
    });
    
    return { user, profile };
  });
}
```

### Repository Pattern

```typescript
// user.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database.service';

@Injectable()
export class UserRepository {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async create(data: CreateUserDto) {
    return this.prisma.user.create({ data });
  }

  async softDelete(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { deleted_at: new Date() }
    });
  }
}
```

## Schema

### User Model

```prisma
model User {
  id             String    @id @default(uuid())
  email          String    @unique
  email_verified Boolean   @default(false)
  tenant_id      String
  metadata       Json?
  created_at     DateTime  @default(now())
  updated_at     DateTime  @updatedAt
  deleted_at     DateTime?

  @@index([email])
  @@index([tenant_id])
  @@index([created_at])
}
```

## Migrations

### Create Migration

```bash
# Development
npx prisma migrate dev --name add_user_metadata

# Production
npx prisma migrate deploy
```

### Rollback Migration

Rollback is manual. Create a new migration that reverses changes:

```bash
npx prisma migrate dev --name revert_user_metadata
```

See [Migration Guide](../../db/migrations/README.md) for details.

## Connection Pooling

### Configuration

```typescript
// database.service.ts
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  log: ['query', 'error', 'warn'],
});

// Connection pool settings (in DATABASE_URL)
// postgres://user:pass@host:5432/db?connection_limit=20&pool_timeout=10
```

### Pool Monitoring

```typescript
// Track active connections
await this.prisma.$queryRaw`
  SELECT count(*) 
  FROM pg_stat_activity 
  WHERE datname = current_database()
`;
```

## Performance Optimization

### Indexes

```prisma
@@index([email])              // Single column
@@index([tenant_id, email])   // Composite index
@@index([created_at(sort: Desc)])  // Sorted index
```

### Query Optimization

```typescript
// Use select to fetch only needed fields
const users = await this.prisma.user.findMany({
  select: {
    id: true,
    email: true,
    // Omit metadata, created_at, etc.
  }
});

// Use include for relations (avoid N+1)
const users = await this.prisma.user.findMany({
  include: {
    profile: true,
    sessions: true
  }
});

// Pagination
const users = await this.prisma.user.findMany({
  skip: (page - 1) * limit,
  take: limit,
  orderBy: { created_at: 'desc' }
});
```

### Connection Reuse

```typescript
// WRONG: Creates new client per request
@Injectable()
export class UserService {
  async getUser() {
    const prisma = new PrismaClient(); // ❌
    return prisma.user.findFirst();
  }
}

// CORRECT: Reuse singleton client
@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {} // ✅
  
  async getUser() {
    return this.prisma.user.findFirst();
  }
}
```

## Error Handling

```typescript
try {
  await this.prisma.user.create({ data });
} catch (error) {
  if (error.code === 'P2002') {
    // Unique constraint violation
    throw new ConflictException('Email already exists');
  }
  throw new InternalServerErrorException('Database error');
}
```

### Common Prisma Error Codes

| Code | Description | HTTP Status |
|------|-------------|-------------|
| P2002 | Unique constraint violation | 409 Conflict |
| P2025 | Record not found | 404 Not Found |
| P2003 | Foreign key constraint | 400 Bad Request |
| P2034 | Transaction conflict | 409 Conflict |

## Observability

### Query Logging

```typescript
// database.service.ts
const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
  ],
});

prisma.$on('query', (e) => {
  logger.debug('Query executed', {
    query: e.query,
    duration: e.duration,
    correlation_id: requestContext.correlationId
  });
});
```

### Metrics (Prometheus)

```typescript
// Track query duration
const queryDurationHistogram = new Histogram({
  name: 'prisma_query_duration_seconds',
  help: 'Prisma query duration',
  labelNames: ['operation', 'model'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
});

prisma.$use(async (params, next) => {
  const start = Date.now();
  const result = await next(params);
  const duration = (Date.now() - start) / 1000;
  
  queryDurationHistogram.observe({
    operation: params.action,
    model: params.model
  }, duration);
  
  return result;
});
```

### Connection Pool Metrics

```typescript
const poolConnectionsGauge = new Gauge({
  name: 'prisma_pool_connections_active',
  help: 'Active database connections'
});

setInterval(async () => {
  const result = await prisma.$queryRaw`
    SELECT count(*) as count FROM pg_stat_activity
  `;
  poolConnectionsGauge.set(result[0].count);
}, 10000);
```

## Testing

### Unit Tests (Mock Prisma)

```typescript
// user.service.spec.ts
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};

const module = await Test.createTestingModule({
  providers: [
    UserService,
    { provide: PrismaService, useValue: mockPrisma },
  ],
}).compile();

// Test
it('should find user by email', async () => {
  mockPrisma.user.findUnique.mockResolvedValue({ id: '1', email: 'test@example.com' });
  
  const user = await service.findByEmail('test@example.com');
  
  expect(user).toBeDefined();
  expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
    where: { email: 'test@example.com' }
  });
});
```

### Integration Tests (Real Database)

```typescript
// user.repository.integration.spec.ts
describe('UserRepository (Integration)', () => {
  let prisma: PrismaClient;
  let repository: UserRepository;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.TEST_DATABASE_URL } }
    });
    repository = new UserRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean database
    await prisma.user.deleteMany({});
  });

  it('should create and retrieve user', async () => {
    const user = await repository.create({
      email: 'test@example.com',
      tenant_id: 'test-tenant'
    });

    const found = await repository.findById(user.id);
    expect(found?.email).toBe('test@example.com');
  });
});
```

## Troubleshooting

### Issue: Connection Pool Exhausted

**Symptom**: `Error: Can't reach database server`

**Solution**:
```bash
# Increase connection limit in DATABASE_URL
DATABASE_URL="postgresql://user:pass@host:5432/db?connection_limit=50"

# Or scale pods horizontally
kubectl scale deployment signup-backend --replicas=5
```

### Issue: Slow Queries

**Symptom**: High p95 query latency

**Solution**:
```sql
-- Check slow queries
SELECT query, mean_exec_time, calls 
FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 10;

-- Add missing indexes
CREATE INDEX idx_users_email ON users(email);
```

### Issue: Migration Drift

**Symptom**: `Schema drift detected`

**Solution**:
```bash
# Check migration status
npx prisma migrate status

# Resolve drift (development only)
npx prisma migrate reset

# Production: apply missing migrations
npx prisma migrate deploy
```

## Related Documentation

- [Prisma Schema Reference](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference)
- [Migration Guide](../../db/migrations/README.md)
- [Production Runbook](../../docs/production-readiness/runbook.md)
