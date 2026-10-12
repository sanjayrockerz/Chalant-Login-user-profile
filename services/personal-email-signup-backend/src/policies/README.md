# Policy acceptance wiring for personal-email-signup-backend

This describes how to wire the acceptance controller and service in the NestJS app.

1. Set ACTIVE_POLICY_VERSION in your environment (deployment or `.env`):

```bash
export ACTIVE_POLICY_VERSION=v2025-10-07-1
```

2. Register TypeORM entities (add `PolicyAcceptanceHistory` and ensure `User` entity has `termsVersion`/`termsAcceptedAt` fields if you store them in DB schema). For example, in `postgres-database.module.ts` add the new entity to the `entities` array and remove `synchronize: true` in production.

3. Add `PoliciesModule` wiring to `app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PoliciesService } from './policies/policies.service';
import { PoliciesController } from './policies/policies.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PolicyAcceptanceHistory } from './entities/policy-acceptance-history.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PolicyAcceptanceHistory])],
  controllers: [PoliciesController],
  providers: [PoliciesService]
})
export class PoliciesModule {}
```

4. Ensure your authentication guard provides `req.user.id`.

5. Tests: add unit tests for `PoliciesService` to verify idempotency and history insertion.
