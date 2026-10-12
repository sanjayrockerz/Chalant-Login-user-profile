import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import winston from 'winston';
import Transport from 'winston-transport';
import { randomUUID } from 'crypto';
import { PushPlatform, PushTokenType } from '../dto/push-token.dto';

type LokiLogPayload = {
  streams: Array<{
    stream: Record<string, string>;
    values: [string, string][];
  }>;
};

interface LokiTransportOptions extends Transport.TransportStreamOptions {
  endpoint: string;
  tenantId?: string;
  labels?: Record<string, string>;
}

class LokiTransport extends Transport {
  private readonly endpoint: string;
  private readonly tenantId?: string;
  private readonly baseLabels: Record<string, string>;

  constructor(options: LokiTransportOptions) {
    super(options);
    this.endpoint = options.endpoint;
    this.tenantId = options.tenantId;
    this.baseLabels = options.labels ?? {};
  }

  async log(info: any, callback: () => void): Promise<void> {
    setImmediate(() => this.emit('logged', info));

    try {
      const now = BigInt(Date.now()) * 1000000n; // Loki expects nanoseconds
      const payload: LokiLogPayload = {
        streams: [
          {
            stream: {
              ...this.baseLabels,
              level: info.level,
            },
            values: [[now.toString(), JSON.stringify(info)]],
          },
        ],
      };

      const fetchFn = (globalThis as any).fetch;
      if (!fetchFn) {
        throw new Error('Fetch API not available in current runtime');
      }

      await fetchFn(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.tenantId ? { 'X-Scope-OrgID': this.tenantId } : {}),
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (!this.silent) {
        // eslint-disable-next-line no-console
        console.error('Failed to push Loki log', error);
      }
    }

    callback();
  }
}

interface RegisteredEvent {
  tokenId: string;
  userId: string;
  platform: PushPlatform;
  tokenType: PushTokenType;
  tenantId: string;
  correlationId: string;
  hasDeviceMetadata: boolean;
  isNewToken: boolean;
}

interface RefreshedEvent {
  userId: string;
  platform: PushPlatform;
  tenantId: string;
  oldTokenId: string;
  newTokenId: string;
  correlationId: string;
}

interface UnregisteredEvent {
  userId: string;
  platform: PushPlatform;
  tenantId: string;
  correlationId: string;
  reason: string;
  unregisteredCount: number;
}

interface InvalidatedEvent {
  userId: string;
  platform: PushPlatform;
  tenantId: string;
  tokenId: string;
  correlationId: string;
  reason: 'failure_threshold' | 'feedback_api' | 'cleanup_job' | 'hard_error';
  errorCode?: string;
}

interface DeliverySuccessEvent {
  tokenId: string;
  platform: PushPlatform;
  correlationId: string;
  notificationType?: string;
  tenantId?: string;
}

interface DeliveryFailureEvent {
  tokenId: string;
  platform: PushPlatform;
  correlationId: string;
  errorCode: string;
  attemptNumber: number;
  tenantId?: string;
}

@Injectable()
export class PushTokenAuditLoggerService {
  private readonly logger = new Logger(PushTokenAuditLoggerService.name);
  private readonly auditLogger: winston.Logger;
  private readonly lokiEnabled: boolean;

  constructor(private readonly configService: ConfigService) {
    const lokiUrl =
      this.configService.get<string>('observability.lokiUrl') ||
      this.configService.get<string>('LOKI_URL');
    const lokiTenant =
      this.configService.get<string>('observability.lokiOrgId') ||
      this.configService.get<string>('LOKI_ORG_ID');

    this.lokiEnabled = Boolean(lokiUrl);

    const transports: Transport[] = [
      new winston.transports.Console({
        level: 'info',
        format: winston.format.json(),
      }) as Transport,
    ];

    if (lokiUrl) {
      transports.push(
        new LokiTransport({
          level: 'info',
          endpoint: lokiUrl,
          tenantId: lokiTenant,
          labels: {
            service: 'push-token-service',
            source: 'auth-backend',
          },
        }),
      );
    }

    this.auditLogger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
      defaultMeta: {
        component: 'push-tokens',
      },
      transports,
    });
  }

  async logRegistered(event: RegisteredEvent): Promise<void> {
    const payload = this.buildEventPayload('push_tokens.registered', {
      user_id: event.userId,
      platform: event.platform,
      token_type: event.tokenType,
      token_id: event.tokenId,
      tenant_id: event.tenantId,
      has_device_metadata: event.hasDeviceMetadata,
      is_new_token: event.isNewToken,
    }, event.correlationId);

    this.write(payload);
  }

  async logRefreshed(event: RefreshedEvent): Promise<void> {
    const payload = this.buildEventPayload('push_tokens.refreshed', {
      user_id: event.userId,
      platform: event.platform,
      old_token_id: event.oldTokenId,
      new_token_id: event.newTokenId,
      tenant_id: event.tenantId,
    }, event.correlationId);

    this.write(payload);
  }

  async logUnregistered(event: UnregisteredEvent): Promise<void> {
    const payload = this.buildEventPayload('push_tokens.unregistered', {
      user_id: event.userId,
      platform: event.platform,
      tenant_id: event.tenantId,
      reason: event.reason,
      unregistered_count: event.unregisteredCount,
    }, event.correlationId);

    this.write(payload);
  }

  async logInvalidated(event: InvalidatedEvent): Promise<void> {
    const payload = this.buildEventPayload('push_tokens.invalidated', {
      user_id: event.userId,
      platform: event.platform,
      tenant_id: event.tenantId,
      token_id: event.tokenId,
      reason: event.reason,
      error_code: event.errorCode,
    }, event.correlationId);

    this.write(payload);
  }

  async logDeliverySuccess(event: DeliverySuccessEvent): Promise<void> {
    const payload = this.buildEventPayload('push_tokens.delivery_success', {
      token_id: event.tokenId,
      platform: event.platform,
      notification_type: event.notificationType,
      tenant_id: event.tenantId,
    }, event.correlationId);

    this.write(payload);
  }

  async logDeliveryFailure(event: DeliveryFailureEvent): Promise<void> {
    const payload = this.buildEventPayload('push_tokens.delivery_failure', {
      token_id: event.tokenId,
      platform: event.platform,
      error_code: event.errorCode,
      attempt_number: event.attemptNumber,
      tenant_id: event.tenantId,
    }, event.correlationId);

    this.write(payload);
  }

  private write(payload: Record<string, unknown>): void {
    this.auditLogger.info(payload);

    if (!this.lokiEnabled) {
      this.logger.debug({
        message: 'Audit event emitted (Loki disabled)',
        event_type: payload['event_type'],
        correlation_id: payload['correlation_id'],
      });
    }
  }

  private buildEventPayload(
    eventType: string,
    data: Record<string, unknown>,
    correlationId?: string,
  ): Record<string, unknown> {
    const sanitized = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    );

    return {
      event_type: eventType,
      correlation_id: correlationId ?? randomUUID(),
      timestamp: new Date().toISOString(),
      ...sanitized,
    };
  }
}
