import express, { Request, Response, NextFunction } from 'express';
import { DatabaseManager } from '../database/database-manager';
import { logger, logHelpers } from '../utils/logger';
import { emitAudit, buildAuditEvent } from '../events/audit-emitter';

// Optional Prometheus metrics (lazy require to keep dependency optional)
let promClient: any = null;
let termsAcceptedCounter: any = null;
let invalidTermsCounter: any = null;
let termsLatencyHistogram: any = null;
try {
  promClient = require('prom-client');
  termsAcceptedCounter = new promClient.Counter({ name: 'terms_accepted_total', help: 'Total number of successful terms accepted' });
  invalidTermsCounter = new promClient.Counter({ name: 'invalid_terms_version_total', help: 'Total number of invalid terms version attempts' });
  termsLatencyHistogram = new promClient.Histogram({ name: 'terms_accept_latency_seconds', help: 'Latency histogram for terms acceptance endpoint', buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2] });
} catch (e) {
  // prom-client not installed; metrics will be no-ops
}

// OpenTelemetry tracer (optional)
let tracer: any = null;
try {
  const { trace } = require('@opentelemetry/api');
  tracer = trace.getTracer('login-page-back');
} catch (e) {
  tracer = null;
}

const ACTIVE_POLICY_VERSION = process.env.ACTIVE_POLICY_VERSION || 'v2025-10-07-1';
// Enforcement modes: 'off' (no enforcement), 'canary' (enforce for listed tenants), 'global' (enforce for all)
const ENFORCE_MODE = (process.env.REQUIRE_TERMS_ENFORCE_MODE || 'off').toLowerCase();
const CANARY_TENANTS = (process.env.REQUIRE_TERMS_CANARY_TENANTS || '').split(',').map(s => s.trim()).filter(Boolean);

// Middleware to validate that registration payload contains the active policy version
export function validateTermsOnRegistration(req: Request, res: Response, next: NextFunction) {
  try {
    const termsVersion = req.body?.terms_version;
    if (!termsVersion || termsVersion !== ACTIVE_POLICY_VERSION) {
      return res.status(400).json({
        code: 'policy_version_mismatch',
        message: `You must accept the active Terms & Privacy (${ACTIVE_POLICY_VERSION}) before registering. Please run the acceptance flow first.`,
        active_policy_version: ACTIVE_POLICY_VERSION
      });
    }

    return next();
  } catch (err) {
    logger.error('validateTermsOnRegistration error', { error: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({ code: 'internal_error' });
  }
}

// Router exposing an authenticated acceptance endpoint
export const router = express.Router();

// NOTE: This handler assumes an authentication middleware has populated `req.user` with at least an `id`.
router.post('/policies/accept', async (req: Request, res: Response) => {
  const db = DatabaseManager.getInstance();
  const start = process.hrtime();
  // Start OTEL span if tracer available
  const span = tracer ? tracer.startSpan('legal.accept') : null;
  try {
    const user = (req as any).user;
    if (!user || !user.id) return res.status(401).json({ code: 'unauthorized' });

    const policyVersion = req.body?.policy_version || req.body?.policyVersion;
    // Enforcement gating
    const tenantId = (user as any)?.tenantId;
    const shouldEnforce = ENFORCE_MODE === 'global' || (ENFORCE_MODE === 'canary' && tenantId && CANARY_TENANTS.includes(String(tenantId)));

    if (!policyVersion || policyVersion !== ACTIVE_POLICY_VERSION) {
      // If enforcement is disabled for this tenant, treat as accepted (no-op) but emit metrics for visibility
      if (!shouldEnforce) {
        if (invalidTermsCounter) invalidTermsCounter.inc();
        // audit: non-enforced mismatch (monitoring only)
        emitAudit(buildAuditEvent(req, 'legal.accept', 'failure', {
          tenantId,
          actor: user?.id,
          metadata: { terms_version: policyVersion }
        }));
        // Return 200 but indicate that enforcement is not applied in this environment
        return res.status(200).json({ ok: true, policy_version: ACTIVE_POLICY_VERSION, accepted_at: null, enforcement: 'skipped' });
      }
      // enforcement active for this tenant -> reject
      // metrics
      if (invalidTermsCounter) invalidTermsCounter.inc();
      // audit: emit legal.accept with outcome=failure
      emitAudit(buildAuditEvent(req, 'legal.accept', 'failure', {
        tenantId: user?.tenantId,
        actor: user?.id,
        metadata: { terms_version: policyVersion },
      }));
      if (span) span.setAttribute('outcome', 'failure');
      return res.status(400).json({ code: 'unknown_policy_version', message: 'The policy_version provided is not recognized. Please fetch the latest policy_version from the application or contact support.' });
    }

    // Fetch current user record
    const existingUser = await db.findUserById(user.id);

    // If already accepted this version, return idempotent 200
    if (existingUser && existingUser.termsVersion === policyVersion) {
      return res.status(200).json({ ok: true, policy_version: policyVersion, accepted_at: existingUser.termsAcceptedAt || null });
    }

    const acceptedAt = new Date();

    // Update latest acceptance on users table (use camelCase from application layer)
    await db.updateUser(user.id, {
      termsVersion: policyVersion,
      termsAcceptedAt: acceptedAt
    } as any);

    // Append to history ledger iff not exists (idempotent for the same version)
    try {
      await db.query(
        `INSERT INTO policy_acceptance_history (user_id, policy_version, accepted_at, source)
         SELECT $1, $2, $3, $4
         WHERE NOT EXISTS (
           SELECT 1 FROM policy_acceptance_history WHERE user_id = $1 AND policy_version = $2
         )`,
        [user.id, policyVersion, acceptedAt.toISOString(), 'api']
      );
    } catch (innerErr) {
      // Non-fatal: history insertion shouldn't block acceptance, but log for auditability
      logger.warn('Failed to append to policy_acceptance_history', { error: innerErr instanceof Error ? innerErr.message : String(innerErr) });
    }
  // Metrics: success
  if (termsAcceptedCounter) termsAcceptedCounter.inc();

  // Emit an operational/audit log (structured) using security logger helper
  logHelpers.logSecurityEvent('policy_acceptance', { policyVersion, acceptedAt: acceptedAt.toISOString(), source: 'api' }, user.id);

  // Emit compliance audit event 'legal.accept' (minimal fields)
  emitAudit(buildAuditEvent(req, 'legal.accept', 'success', {
    tenantId: user?.tenantId,
    actor: user?.id,
    metadata: { terms_version: policyVersion },
  }));

  if (span) {
    span.setAttribute('correlation_id', req.headers['x-correlation-id'] || req.correlationId || null);
    span.setAttribute('tenant_id', user?.tenantId || null);
    span.setAttribute('subject_id', user?.id || null);
    span.setAttribute('terms_version', policyVersion);
    span.setAttribute('outcome', 'success');
    span.end();
  }

  const duration = process.hrtime(start);
  const seconds = duration[0] + duration[1] / 1e9;
  if (termsLatencyHistogram) termsLatencyHistogram.observe(seconds);

    return res.status(200).json({ ok: true, policy_version: policyVersion, accepted_at: acceptedAt });
  } catch (error) {
    if (span) span.setStatus({ code: 2, message: error instanceof Error ? error.message : String(error) });
    logger.error('Error in /policies/accept', { error: error instanceof Error ? error.message : String(error) });
    return res.status(500).json({ code: 'internal_error' });
  }
});

export default router;
