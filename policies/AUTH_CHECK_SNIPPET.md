# Auth Check Snippet — detect policy version mismatch and require re-acceptance

This snippet shows a pattern for checking `accepted_policy_version` against the active policy during authentication and requiring re-acceptance when mismatched.

Pseudo-code (Node/Express):

```js
// load active policy version from repository or an environment variable
const activePolicy = process.env.ACTIVE_POLICY_VERSION || 'v2025-10-07-1';

// Example middleware during login or session validation
async function requirePolicyAcceptance(req, res, next) {
  const user = req.user; // logged-in user object
  if (!user) return next(); // not authenticated yet

  if (!user.accepted_policy_version || user.accepted_policy_version !== activePolicy) {
    // Redirect user to policy acceptance flow
    return res.status(409).json({
      code: 'policy_mismatch',
      message: 'You must accept the updated Terms & Privacy to continue.',
      active_policy_version: activePolicy,
      accept_url: `/policies/accept?version=${activePolicy}`
    });
  }

  return next();
}

// On acceptance endpoint handler
app.post('/policies/accept', async (req, res) => {
  const user = req.user;
  const version = req.query.version || req.body.version;
  if (!user || !version) return res.status(400).end();

  // Persist acceptance
  await db.query('UPDATE users SET accepted_policy_version=$1, accepted_policy_at=now() WHERE id=$2', [version, user.id]);

  res.json({ ok: true });
});
```

Notes
- To make this auditable, log acceptance events to an append-only audit table.
- Consider exposing an endpoint where users can view the policy they accepted and the timestamp.
- During activation, you may want to force re-acceptance for all users; populate `accepted_policy_version` accordingly or null it out to force acceptance.
