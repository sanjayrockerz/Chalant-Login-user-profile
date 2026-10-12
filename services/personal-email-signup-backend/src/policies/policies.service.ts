import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Logger } from '@nestjs/common';
import { emitAudit, buildAuditEvent } from '../../../login-page-back/src/events/audit-emitter';

// Optional tracer
let tracer: any = null;
try {
  const { trace } = require('@opentelemetry/api');
  tracer = trace.getTracer('personal-email-signup-backend');
} catch (e) {
  tracer = null;
}

import { User } from '../entities/user.entity';
import { PolicyAcceptanceHistory } from '../entities/policy-acceptance-history.entity';

@Injectable()
export class PoliciesService {
  private readonly logger = new Logger(PoliciesService.name);
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(PolicyAcceptanceHistory)
    private readonly historyRepo: Repository<PolicyAcceptanceHistory>
  ) {}

  async acceptPolicy(userId: string, policyVersion: string, source = 'api') {
    const span = tracer ? tracer.startSpan('legal.accept') : null;
    // Validate policyVersion against env
    const active = process.env.ACTIVE_POLICY_VERSION || 'v2025-10-07-1';
    if (policyVersion !== active) {
      if (span) { span.setAttribute('outcome', 'failure'); span.end(); }
      throw new Error('unknown_policy_version');
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new Error('not_found');

    // Idempotent update: only update user's latest fields
    if (user.termsVersion === policyVersion) {
      return { ok: true, policy_version: policyVersion, accepted_at: user.termsAcceptedAt };
    }

    user.termsVersion = policyVersion;
    user.termsAcceptedAt = new Date();
    await this.userRepo.save(user);

    // Append to history if not exists
  const existing = await this.historyRepo.findOne({ where: { userId, policyVersion } });
    if (!existing) {
      const h = this.historyRepo.create({ userId, policyVersion, acceptedAt: new Date(), source });
      await this.historyRepo.save(h);
    }

    // Emit a minimal, non-PII audit log entry per ACCEPTANCE_LOGGING_GUIDELINES
    try {
      this.logger.log(JSON.stringify({
        event: 'policy_acceptance',
        user_id: userId,
        policy_version: policyVersion,
        accepted_at: (user.termsAcceptedAt || new Date()).toISOString(),
        source
      }));
    } catch (e) {
      // Logging must not interrupt the acceptance flow
      this.logger.warn('Failed to log policy acceptance audit entry');
    }

    // Emit canonical legal.accept audit event (non-blocking)
    try {
      emitAudit(buildAuditEvent({ user: { userId }, headers: {}, body: {} } as any, 'legal.accept', 'success', {
        tenantId: (user as any).tenantId,
        actor: String(userId),
        metadata: { terms_version: policyVersion }
      }));
    } catch (e) {
      this.logger.warn('Failed to emit legal.accept audit event');
    }

    if (span) {
      span.setAttribute('tenant_id', (user as any).tenantId || null);
      span.setAttribute('subject_id', String(userId));
      span.setAttribute('terms_version', policyVersion);
      span.setAttribute('outcome', 'success');
      span.end();
    }

    return { ok: true, policy_version: policyVersion, accepted_at: user.termsAcceptedAt };
  }
}
