# ADR Template

Use this template to document significant architectural decisions in the project.

---

## [Number]. [Title]

**Date**: YYYY-MM-DD  
**Status**: [Proposed | Accepted | Deprecated | Superseded by ADR-XXX]  
**Deciders**: [List of people involved in decision]  
**Technical Story**: [Link to JIRA/GitHub issue]

## Context and Problem Statement

Describe the architectural issue or decision that needs to be made. What is the context? What factors are at play?

**Example**:
> We need to decide on an authentication mechanism for the signup service. The current password-based system has poor UX (users forget passwords) and security concerns (password reuse, weak passwords). We need a more secure and user-friendly approach.

## Decision Drivers

What forces are at play? What are the constraints and priorities?

* **Driver 1**: [e.g., Security - must prevent unauthorized access]
* **Driver 2**: [e.g., User Experience - must be simple for users]
* **Driver 3**: [e.g., Cost - must work within current infrastructure budget]
* **Driver 4**: [e.g., Time to Market - need to ship within 6 weeks]
* **Driver 5**: [e.g., Compliance - must meet GDPR/CCPA requirements]

## Considered Options

List all alternatives that were seriously evaluated.

* **Option 1**: [e.g., Password-based authentication with 2FA]
* **Option 2**: [e.g., Magic link email authentication]
* **Option 3**: [e.g., OTP (One-Time Password) via email]
* **Option 4**: [e.g., OAuth2 with third-party providers (Google, GitHub)]

## Decision Outcome

Chosen option: **"[Option Title]"**

**Rationale**: Explain why this option was chosen. How does it satisfy the decision drivers?

**Example**:
> Chosen option: "OTP (One-Time Password) via email" because:
> - Security: No password storage, no password reuse attacks
> - UX: Users only need email access, no password to remember
> - Cost: Reuses existing email infrastructure (AWS SES)
> - Time: Can be implemented with existing NestJS + Prisma stack in 4 weeks
> - Compliance: Email verification satisfies identity verification requirements

### Consequences

#### Positive
* [e.g., Improved security - no password database to breach]
* [e.g., Better UX - passwordless flow reduces friction]
* [e.g., Lower support costs - fewer "forgot password" tickets]

#### Negative
* [e.g., Email delivery dependency - if email fails, users can't sign in]
* [e.g., OTP expiration UX - users must complete flow within 10 minutes]
* [e.g., Rate limiting complexity - must prevent OTP spam attacks]

#### Neutral
* [e.g., Redis required for OTP storage - acceptable, already in stack]
* [e.g., Email templates needed - design effort required]

## Validation

How will we know if this decision was correct? What metrics will we track?

* **Metric 1**: [e.g., Signup completion rate > 80%]
* **Metric 2**: [e.g., Authentication error rate < 0.1%]
* **Metric 3**: [e.g., Time to sign up < 2 minutes (p95)]
* **Metric 4**: [e.g., Support tickets related to auth < 5/week]

**Review Date**: [e.g., 3 months after implementation]

## Pros and Cons of the Options

### Option 1: [Option Title]

**Description**: [Brief description of the option]

**Pros**:
* [Pro 1]
* [Pro 2]
* [Pro 3]

**Cons**:
* [Con 1]
* [Con 2]
* [Con 3]

**Technical Details**:
* Implementation effort: [e.g., 2 weeks]
* Dependencies: [e.g., bcrypt library, PostgreSQL]
* Scalability: [e.g., Scales linearly with database]

---

### Option 2: [Option Title]

**Description**: [Brief description of the option]

**Pros**:
* [Pro 1]
* [Pro 2]

**Cons**:
* [Con 1]
* [Con 2]

**Technical Details**:
* Implementation effort: [e.g., 3 weeks]
* Dependencies: [e.g., AWS SES, Redis]
* Scalability: [e.g., Requires email service rate limits]

---

### Option 3: [Option Title]

*(Repeat for each option)*

## Related Decisions

* [ADR-001: Choice of Database](./001-database-choice.md)
* [ADR-003: Email Service Provider](./003-email-provider.md)

## Implementation Plan

High-level steps to implement the decision (if accepted):

1. **Phase 1**: [e.g., Design OTP email templates]
2. **Phase 2**: [e.g., Implement OTP generation and validation service]
3. **Phase 3**: [e.g., Integrate Redis for OTP storage]
4. **Phase 4**: [e.g., Add rate limiting and security controls]
5. **Phase 5**: [e.g., Deploy to staging and conduct security audit]
6. **Phase 6**: [e.g., Gradual rollout to production (10% → 100%)]

## References

* [Link to research document]
* [Link to proof of concept]
* [Link to security review]
* [Link to competitor analysis]

---

## Notes

* Use this template for decisions that have significant impact on architecture, security, performance, or cost
* Minor implementation details don't need ADRs
* Keep ADRs concise but comprehensive
* Store ADRs in `docs/adr/` with naming convention: `NNN-title-in-kebab-case.md`
* Number ADRs sequentially (001, 002, 003...)
* Update status when decisions change (e.g., "Superseded by ADR-025")
