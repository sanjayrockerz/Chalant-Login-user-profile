import { Injectable } from '@nestjs/common';
import { register, Counter, Histogram, Registry } from 'prom-client';

@Injectable()
export class MetricsService {
  public usernameConflictsTotal: Counter<string>;
  public requestLatencySeconds: Histogram<string>;
  public pronounsSetTotal: Counter<string>;
  public profileImageSetTotal: Counter<string>;
  private readonly registry: Registry;
  
  // Request counters
  public readonly requestsTotal: Counter<string>;
  public readonly errorsTotal: Counter<string>;
  
  // Request duration histogram
  public readonly requestDuration: Histogram<string>;
  
  // Business metrics
  public readonly signupsTotal: Counter<string>;
  public readonly verificationsTotal: Counter<string>;
  public readonly providerErrorsTotal: Counter<string>;
  
  // OTP metrics
  public readonly otpRequestsTotal: Counter<string>;
  public readonly otpResendsTotal: Counter<string>;
  public readonly otpVerifiedTotal: Counter<string>;
  public readonly otpVerifyFailsTotal: Counter<string>;
  public readonly otpResendBlockedTotal: Counter<string>;
  public readonly otpErrorsTotal: Counter<string>;

  // Risk tier metrics
  public readonly otpRequestsByTier: Counter<string>;
  public readonly otpVerificationOutcomeByTier: Counter<string>;
  
  // Performance histograms
  public readonly otpOperationDuration: Histogram<string>;
  public readonly emailDeliveryDuration: Histogram<string>;
  
  // Abuse metrics
  public readonly suspiciousEventsTotal: Counter<string>;

  // Identity validation metrics
  public readonly identityRegistrationsTotal: Counter<string>;
  public readonly underageDeniedTotal: Counter<string>;
  public readonly identityValidationLatency: Histogram<string>;
  
  // Terms acceptance metrics
  public readonly termsAcceptedTotal: Counter<string>;
  public readonly invalidTermsVersionTotal: Counter<string>;
  public readonly termsAcceptanceLatency: Histogram<string>;
  
  // Username management metrics
  public readonly usernameChecksTotal: Counter<string>;
  public readonly usernameUpdatesTotal: Counter<string>;
  public readonly usernameCheckLatency: Histogram<string>;
  public readonly usernameUpdateLatency: Histogram<string>;
  
  // Deliverability metrics
  public readonly emailDeliveryStatus: Counter<string>;

  constructor() {
    this.registry = new Registry();
    
    // Initialize metrics
    this.requestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.errorsTotal = new Counter({
      name: 'http_errors_total',
      help: 'Total number of HTTP errors',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this.requestDuration = new Histogram({
      name: 'http_request_duration_ms',
      help: 'Duration of HTTP requests in milliseconds',
      labelNames: ['method', 'route'],
      buckets: [1, 5, 15, 50, 100, 500, 1000, 5000],
      registers: [this.registry],
    });

    this.signupsTotal = new Counter({
      name: 'signups_total',
      help: 'Total number of user signups',
      registers: [this.registry],
    });

    this.verificationsTotal = new Counter({
      name: 'verifications_total',
      help: 'Total number of email verifications',
      registers: [this.registry],
    });

    this.providerErrorsTotal = new Counter({
      name: 'provider_errors_total',
      help: 'Total number of external provider errors',
      labelNames: ['provider', 'error_type'],
      registers: [this.registry],
    });

    // OTP metrics initialization
    this.otpRequestsTotal = new Counter({
      name: 'otp_requests_total',
      help: 'Total number of OTP requests',
      registers: [this.registry],
    });

    this.otpResendsTotal = new Counter({
      name: 'otp_resends_total',
      help: 'Total number of OTP resend requests',
      registers: [this.registry],
    });

    this.otpVerifiedTotal = new Counter({
      name: 'otp_verified_total',
      help: 'Total number of successful OTP verifications',
      registers: [this.registry],
    });

    this.otpVerifyFailsTotal = new Counter({
      name: 'otp_verify_fails_total',
      help: 'Total number of failed OTP verification attempts',
      labelNames: ['reason'],
      registers: [this.registry],
    });

    // Risk-tiered OTP metrics
    this.otpRequestsByTier = new Counter({
      name: 'otp_requests_by_tier_total',
      help: 'Total number of OTP requests by risk tier',
      labelNames: ['tier'],
      registers: [this.registry],
    });

    this.otpVerificationOutcomeByTier = new Counter({
      name: 'otp_verification_outcome_by_tier_total',
      help: 'OTP verification outcomes by risk tier',
      labelNames: ['tier', 'outcome'],
      registers: [this.registry],
    });

    this.otpResendBlockedTotal = new Counter({
      name: 'otp_resend_blocked_total',
      help: 'Total number of blocked OTP resend attempts',
      labelNames: ['reason'],
      registers: [this.registry],
    });

    this.otpErrorsTotal = new Counter({
      name: 'otp_errors_total',
      help: 'Total number of OTP service errors',
      labelNames: ['error_type'],
      registers: [this.registry],
    });

    this.suspiciousEventsTotal = new Counter({
      name: 'abuse_suspicious_events_total',
      help: 'Total number of suspicious events detected by the abuse scorer',
      labelNames: ['signal','severity'],
      registers: [this.registry],
    });

    // Identity validation metrics
    this.identityRegistrationsTotal = new Counter({
      name: 'identity_registrations_total',
      help: 'Count of successful registrations with identity fields',
      registers: [this.registry],
    });

    this.underageDeniedTotal = new Counter({
      name: 'underage_denied_total',
      help: 'Count of registrations deterministically denied due to underage',
      registers: [this.registry],
    });

    this.identityValidationLatency = new Histogram({
      name: 'identity_validation_latency_seconds',
      help: 'Latency for identity validation in seconds',
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2],
      registers: [this.registry],
    });

    // Terms acceptance metrics
    this.termsAcceptedTotal = new Counter({
      name: 'terms_accepted_total',
      help: 'Count of terms acceptance events',
      labelNames: ['version'],
      registers: [this.registry],
    });

    this.invalidTermsVersionTotal = new Counter({
      name: 'invalid_terms_version_total',
      help: 'Count of invalid terms version attempts',
      labelNames: ['provided_version', 'required_version'],
      registers: [this.registry],
    });

    this.termsAcceptanceLatency = new Histogram({
      name: 'terms_acceptance_latency_seconds',
      help: 'Latency for terms acceptance processing in seconds',
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2],
      registers: [this.registry],
    });

    // Username metrics
    this.usernameConflictsTotal = new Counter({
      name: 'username_conflicts_total',
      help: 'Total number of username conflicts detected',
      registers: [this.registry],
    });

    this.requestLatencySeconds = new Histogram({
      name: 'request_latency_seconds',
      help: 'Request latency in seconds per route',
      labelNames: ['route'],
      buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.pronounsSetTotal = new Counter({
      name: 'pronouns_set_total',
      help: 'Total number of times users set/update pronouns',
      registers: [this.registry],
    });

    this.profileImageSetTotal = new Counter({
      name: 'profile_image_set_total',
      help: 'Total number of times users set/update profile image pointer',
      registers: [this.registry],
    });

    // New username management metrics
    this.usernameChecksTotal = new Counter({
      name: 'username_checks_total',
      help: 'Total number of username availability checks',
      labelNames: ['check_type', 'outcome', 'client_ip_hash'],
      registers: [this.registry],
    });

    this.usernameUpdatesTotal = new Counter({
      name: 'username_updates_total',
      help: 'Total number of username update attempts',
      labelNames: ['outcome', 'user_id_hash'],
      registers: [this.registry],
    });

    this.usernameCheckLatency = new Histogram({
      name: 'username_check_latency_seconds',
      help: 'Latency for username availability checks in seconds',
      labelNames: ['check_type'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
      registers: [this.registry],
    });

    this.usernameUpdateLatency = new Histogram({
      name: 'username_update_latency_seconds',
      help: 'Latency for username updates in seconds',
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    // Performance histograms
    this.otpOperationDuration = new Histogram({
      name: 'otp_operation_duration_ms',
      help: 'Duration of OTP operations in milliseconds',
      labelNames: ['operation', 'outcome'],
      buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
      registers: [this.registry],
    });

    this.emailDeliveryDuration = new Histogram({
      name: 'email_delivery_duration_ms',
      help: 'Duration of email delivery operations in milliseconds',
      labelNames: ['provider', 'status'],
      buckets: [100, 250, 500, 1000, 2000, 5000, 10000, 30000],
      registers: [this.registry],
    });

    // Deliverability metrics
    this.emailDeliveryStatus = new Counter({
      name: 'email_delivery_status_total',
      help: 'Total email delivery attempts by status',
      labelNames: ['provider', 'status'],
      registers: [this.registry],
    });

    // Register default metrics (process metrics, etc.)
    register.setDefaultLabels({
      app: 'personal-email-signup-backend',
    });
  }

  getRegistry(): Registry {
    return this.registry;
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  incrementRequests(method: string, route: string, statusCode: number): void {
    this.requestsTotal.inc({ method, route, status_code: statusCode.toString() });
  }

  incrementErrors(errorType: string): void {
    this.errorsTotal.inc({ type: errorType });
  }

  observeRequestDuration(method: string, route: string, duration: number): void {
    this.requestDuration.observe({ method, route }, duration);
  }

  incrementSignups(): void {
    this.signupsTotal.inc();
  }

  incrementVerifications(): void {
    this.verificationsTotal.inc();
  }

  incrementProviderErrors(provider: string, errorType: string): void {
    this.providerErrorsTotal.inc({ provider, error_type: errorType });
  }

  // OTP metric methods
  incrementOtpRequests(): void {
    this.otpRequestsTotal.inc();
  }

  incrementOtpResends(): void {
    this.otpResendsTotal.inc();
  }

  incrementOtpVerified(): void {
    this.otpVerifiedTotal.inc();
  }

  incrementOtpVerifyFails(reason: string): void {
    this.otpVerifyFailsTotal.inc({ reason });
  }

  incrementOtpResendBlocked(reason: string): void {
    this.otpResendBlockedTotal.inc({ reason });
  }

  incrementOtpErrors(errorType: string): void {
    this.otpErrorsTotal.inc({ error_type: errorType });
  }

  // Username metric helpers
  incrementUsernameConflicts(): void {
    this.usernameConflictsTotal.inc();
  }

  observeRequestLatency(route: string, durationSeconds: number): void {
    this.requestLatencySeconds.observe({ route }, durationSeconds);
  }

  // Pronouns / profile image helpers
  incrementPronounsSet(): void {
    this.pronounsSetTotal.inc();
  }

  incrementProfileImageSet(): void {
    this.profileImageSetTotal.inc();
  }

  // Identity helpers
  incrementUnderageDenied(): void {
    this.underageDeniedTotal.inc();
  }

  incrementIdentityRegistrations(): void {
    this.identityRegistrationsTotal.inc();
  }

  // Rate limit saturation helper
  incrementRateLimitSaturation(dimension: string): void {
    // we reuse errorsTotal for now with a label to indicate rate-limited dimension
    this.errorsTotal.inc({ type: `rate_limited_${dimension}` });
  }

  incrementSuspiciousEvent(signal: string, severity: string): void {
    this.suspiciousEventsTotal.inc({ signal, severity });
  }

  // Performance metric methods
  observeOtpOperationDuration(operation: string, outcome: string, duration: number): void {
    this.otpOperationDuration.observe({ operation, outcome }, duration);
  }

  observeEmailDeliveryDuration(provider: string, status: string, duration: number): void {
    this.emailDeliveryDuration.observe({ provider, status }, duration);
  }

  // Deliverability metric methods
  incrementEmailDeliveryStatus(provider: string, status: string): void {
    this.emailDeliveryStatus.inc({ provider, status });
  }

  // Username management metric methods
  incrementUsernameChecks(outcome: string, clientIp?: string): void {
    const ipHash = clientIp ? require('crypto').createHash('sha256').update(clientIp).digest('hex').substring(0, 8) : 'unknown';
    this.usernameChecksTotal.inc({ 
      check_type: 'availability', 
      outcome, 
      client_ip_hash: ipHash 
    });
  }

  incrementUsernameUpdates(outcome: string, userId?: string): void {
    const userIdHash = userId ? require('crypto').createHash('sha256').update(userId).digest('hex').substring(0, 8) : 'unknown';
    this.usernameUpdatesTotal.inc({ 
      outcome, 
      user_id_hash: userIdHash 
    });
  }

  recordUsernameCheckLatency(checkType: string, duration: number): void {
    this.usernameCheckLatency.observe({ check_type: checkType }, duration / 1000);
  }

  recordUsernameUpdateLatency(duration: number): void {
    this.usernameUpdateLatency.observe(duration / 1000);
  }
}