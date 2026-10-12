# Policy acceptance wiring for login-page-back

This file explains how to wire the acceptance middleware and router into the `login-page-back` Express app.

1. Set ACTIVE_POLICY_VERSION in your environment (e.g., in deployment or `.env`):

```bash
export ACTIVE_POLICY_VERSION=v2025-10-07-1
```

2. Mount the registration middleware on the registration route to ensure clients provide the active version:

```ts
import express from 'express';
import { validateTermsOnRegistration, router as acceptanceRouter } from './policies/acceptance';

const app = express();

// Registration route example
app.post('/api/register', validateTermsOnRegistration, async (req, res) => {
  // registration logic
});

// Mount acceptance router (requires auth middleware earlier in the chain)
app.use('/api', acceptanceRouter);
```

3. Ensure your authentication middleware populates `req.user.id` for the acceptance endpoint to work.

4. Logs: acceptance events are written via `logHelpers.logSecurityEvent` and conform to `policies/ACCEPTANCE_LOGGING_GUIDELINES.md`.

5. DB: ensure migrations have been applied so `users` and `policy_acceptance_history` columns/tables exist.
