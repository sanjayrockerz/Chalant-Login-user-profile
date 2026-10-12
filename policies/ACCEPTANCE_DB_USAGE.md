# Acceptance DB Usage — examples and queries

This document shows examples for persisting acceptance events and querying user consent state.

1) Inserting an acceptance (idempotent upsert)

SQL (Postgres):
```sql
-- Upsert latest acceptance on users table and append to history
BEGIN;

-- Update latest on users table
UPDATE users SET terms_version = $1, terms_accepted_at = now() WHERE id = $2;

-- Append to history ledger
INSERT INTO policy_acceptance_history (user_id, policy_version, accepted_at, source)
VALUES ($2, $1, now(), $3);

COMMIT;
```

2) Idempotent acceptance (avoid duplicate history entries if same version exists)

```sql
INSERT INTO policy_acceptance_history (user_id, policy_version, accepted_at, source)
SELECT $2, $1, now(), $3
WHERE NOT EXISTS (
  SELECT 1 FROM policy_acceptance_history WHERE user_id = $2 AND policy_version = $1
);
```

3) Query to find users who need to re-accept after a policy update

```sql
SELECT id, email FROM users WHERE terms_version IS NULL OR terms_version <> 'v2025-10-07-1';
```

4) Example ORM snippet (node/knex)

```js
async function recordAcceptance(userId, policyVersion, source = 'web') {
  // update users latest fields
  await knex('users').where({ id: userId }).update({ terms_version: policyVersion, terms_accepted_at: knex.fn.now() });

  // insert into history if not exists
  await knex.raw(`
    INSERT INTO policy_acceptance_history (user_id, policy_version, accepted_at, source)
    SELECT ?, ?, now(), ?
    WHERE NOT EXISTS (SELECT 1 FROM policy_acceptance_history WHERE user_id = ? AND policy_version = ?)
  `, [userId, policyVersion, source, userId, policyVersion]);
}
```

Notes
- The users table should not store policy text, only the `terms_version` identifier and timestamp.
- Use the history ledger for audits and compliance reporting rather than relying on the single `users` row.
