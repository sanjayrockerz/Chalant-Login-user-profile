import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { request as httpsRequest } from "node:https";
import { randomUUID, createHmac, timingSafeEqual } from "crypto";
import {
  AuthSafetyPrismaService,
  PrismaService,
} from "../../prisma/prisma.module";
import { ConfigService } from "../config/config.service";
import { AUTH_LIFECYCLE_EVENT_TYPE } from "./auth-lifecycle-event";
import { MetricsService } from "../metrics/metrics.service";

const EVENT_TYPE = "chat.profile.provision.v1";
const LIFECYCLE_EVENT_TYPE = "chat.account.lifecycle.v1";
const ACCOUNT_DELETION_CLEANUP_EVENT = "auth.account.deletion.cleanup.v1";
const POLL_INTERVAL_MS = 5_000;
const LEASE_MS = 60_000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

@Injectable()
export class ChatProfileOutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatProfileOutboxWorker.name);
  private timer?: NodeJS.Timeout;
  private readonly runningEventTypes = new Set<string>();
  private readonly activeDeliveries = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly safetyPrisma: AuthSafetyPrismaService,
    private readonly config: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  onModuleInit(): void {
    const chatSecret = this.config.get("CHAT_PROFILE_PROVISIONING_HMAC_SECRET");
    const authSecret = this.config.get("AUTH_LIFECYCLE_HMAC_SECRET");
    const profileDeletionSecret = this.config.get(
      "PROFILE_ACCOUNT_DELETION_HMAC_SECRET",
    );
    if (!chatSecret && !authSecret && !profileDeletionSecret) {
      this.logger.warn("Signed lifecycle event delivery is not configured");
      return;
    }
    this.timer = setInterval(() => void this.deliverOne(), POLL_INTERVAL_MS);
    this.timer.unref();
    void this.deliverOne();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([...this.activeDeliveries]);
  }

  async deliverOne(): Promise<void> {
    const routeDefinitions = [
      {
        eventType: EVENT_TYPE,
        destination: "Chat",
        endpointKey: "CHAT_PROFILE_PROVISIONING_URL",
        secretKey: "CHAT_PROFILE_PROVISIONING_HMAC_SECRET",
        headerPrefix: "x-chat-event",
        format: "chat-envelope" as const,
      },
      {
        eventType: LIFECYCLE_EVENT_TYPE,
        destination: "Chat",
        endpointKey: "CHAT_ACCOUNT_LIFECYCLE_URL",
        secretKey: "CHAT_PROFILE_PROVISIONING_HMAC_SECRET",
        headerPrefix: "x-chat-event",
        format: "chat-envelope" as const,
      },
      {
        eventType: AUTH_LIFECYCLE_EVENT_TYPE,
        destination: "Realtime",
        endpointKey: "AUTH_LIFECYCLE_URL",
        secretKey: "AUTH_LIFECYCLE_HMAC_SECRET",
        headerPrefix: "x-auth-lifecycle",
        format: "auth-lifecycle" as const,
      },
      {
        eventType: ACCOUNT_DELETION_CLEANUP_EVENT,
        destination: "Profile",
        endpointKey: "PROFILE_ACCOUNT_DELETION_CLEANUP_URL",
        secretKey: "PROFILE_ACCOUNT_DELETION_HMAC_SECRET",
        headerPrefix: "x-account-deletion",
        format: "account-deletion-cleanup" as const,
      },
    ] as const;
    const routeByType = new Map<
      string,
      {
        endpoint: URL;
        secret: string;
        destination: string;
        headerPrefix: string;
        format: "chat-envelope" | "auth-lifecycle" | "account-deletion-cleanup";
      }
    >();
    for (const route of routeDefinitions) {
      const secretValue = this.config.get(route.secretKey);
      const configuredValue = this.config.get(route.endpointKey);
      if (
        typeof secretValue !== "string" ||
        secretValue.length < 32 ||
        typeof configuredValue !== "string"
      ) {
        continue;
      }
      try {
        const endpoint = new URL(configuredValue);
        if (endpoint.protocol !== "https:") throw new Error("HTTPS required");
        routeByType.set(route.eventType, {
          endpoint,
          secret: secretValue,
          destination: route.destination,
          headerPrefix: route.headerPrefix,
          format: route.format,
        });
      } catch {
        this.logger.error(`Endpoint for ${route.eventType} must use HTTPS`);
      }
    }
    if (routeByType.size === 0) return;

    const deliveries = [...routeByType.keys()]
      .filter((eventType) => !this.runningEventTypes.has(eventType))
      .map((eventType) => {
        this.runningEventTypes.add(eventType);
        const delivery = this.deliverClaimedEvent(
          routeByType,
          eventType,
        ).finally(() => {
          this.runningEventTypes.delete(eventType);
          this.activeDeliveries.delete(delivery);
        });
        this.activeDeliveries.add(delivery);
        return delivery;
      });
    await Promise.allSettled(deliveries);
    await this.refreshBacklogMetrics();
  }

  private async deliverClaimedEvent(
    routeByType: Map<
      string,
      {
        endpoint: URL;
        secret: string;
        destination: string;
        headerPrefix: string;
        format: "auth-lifecycle" | "chat-envelope" | "account-deletion-cleanup";
      }
    >,
    eventType: string,
  ): Promise<void> {
    try {
      const now = new Date();
      const row = await this.prisma.outboxEvent.findFirst({
        where: {
          eventType,
          deliveredAt: null,
          terminalAt: null,
          nextAttemptAt: { lte: now },
          OR: [
            { claimedAt: null },
            { claimedAt: { lt: new Date(now.getTime() - LEASE_MS) } },
          ],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (!row) return;

      if (await this.hasOlderPendingCausalEvent(row)) return;

      const route = routeByType.get(row.eventType);
      if (!route) return;

      const claimToken = randomUUID();
      const claimed = await this.prisma.outboxEvent.updateMany({
        where: {
          id: row.id,
          deliveredAt: null,
          terminalAt: null,
          nextAttemptAt: { lte: now },
          OR: [
            { claimedAt: null },
            { claimedAt: { lt: new Date(now.getTime() - LEASE_MS) } },
          ],
        },
        data: { claimedAt: now, claimToken, attempts: { increment: 1 } },
      });
      if (claimed.count !== 1) return;

      const body =
        route.format === "auth-lifecycle" ||
        route.format === "account-deletion-cleanup"
          ? JSON.stringify(row.payload)
          : JSON.stringify({
              eventId: row.id,
              eventType: row.eventType,
              payload: row.payload,
            });
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = createHmac("sha256", route.secret)
        .update(`${timestamp}.${body}`)
        .digest("hex");
      let authEventId: string | undefined;
      if (route.format === "auth-lifecycle") {
        const payload = row.payload as { eventId?: unknown };
        if (typeof payload.eventId !== "string" || payload.eventId !== row.id) {
          await this.scheduleInvalidAuthLifecycleEvent(row.id, claimToken);
          return;
        }
        authEventId = payload.eventId;
      }
      let requestStartedAt: number | undefined;
      let requestLatencyRecorded = false;
      try {
        const headers: Record<string, string> = {
          "content-type": "application/json",
          // A receiver can durably accept an event and then lose its response.
          // Force retries onto independent connections so that a reset from
          // that lost acknowledgement cannot poison a reused socket.
          connection: "close",
          [`${route.headerPrefix}-timestamp`]: timestamp,
          [`${route.headerPrefix}-signature`]: signature,
        };
        if (authEventId) {
          headers["x-auth-lifecycle-event-id"] = authEventId;
        }
        requestStartedAt = Date.now();
        const response = await this.postLifecycleEvent(
          route.endpoint,
          headers,
          body,
        );
        const durationSeconds = (Date.now() - requestStartedAt) / 1_000;
        this.metrics?.authOutboxDeliveryDurationSeconds.observe(
          { event_type: row.eventType },
          durationSeconds,
        );
        requestLatencyRecorded = true;
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const status = response.statusCode;
          if (status === 400 || status === 422) {
            const terminalAt = new Date();
            const quarantined = await this.prisma.outboxEvent.updateMany({
              where: {
                id: row.id,
                claimToken,
                deliveredAt: null,
                terminalAt: null,
              },
              data: {
                terminalAt,
                deliveryOutcome: "QUARANTINED_INVALID",
                claimedAt: null,
                claimToken: null,
                lastError: `${route.destination} returned HTTP ${status}`,
              },
            });
            if (quarantined.count !== 1)
              throw new Error("Outbox quarantine claim was no longer current");
            this.metrics?.authOutboxDeliveriesTotal.inc({
              event_type: row.eventType,
              outcome: "quarantined_invalid",
            });
            this.logger.error(
              `${row.eventType} event quarantined eventId=${row.id} status=${status}`,
            );
            return;
          }
          throw new Error(
            `${route.destination} returned HTTP ${response.statusCode}`,
          );
        }
        const supersededReceipt =
          route.format === "chat-envelope"
            ? this.validateChatAcknowledgement(
                response.body,
                row.id,
                row.eventType,
                row.payload,
                route.secret,
              )
            : undefined;
        let deliveryUpdate: { count: number };
        if (supersededReceipt) {
          deliveryUpdate = await this.prisma.outboxEvent.updateMany({
            where: {
              id: row.id,
              claimToken,
              deliveredAt: null,
              terminalAt: null,
            },
            data: {
              terminalAt: new Date(),
              deliveryOutcome: "SUPERSEDED_BY_DELETION",
              claimedAt: null,
              claimToken: null,
              lastError: null,
            },
          });
        } else if (route.format === "account-deletion-cleanup") {
          const receipt = this.validateCleanupReceipt(
            response.body,
            row.payload,
            route.secret,
          );
          deliveryUpdate = await this.safetyPrisma.$transaction(async (tx) => {
            const operation = await tx.safetyOperation.findUnique({
              where: { id: receipt.operationId },
              select: { requestMetadata: true },
            });
            const metadata = operation?.requestMetadata;
            if (
              !metadata ||
              typeof metadata !== "object" ||
              Array.isArray(metadata)
            )
              throw new Error(
                "Deletion SOC metadata missing for cleanup receipt",
              );
            const current = metadata as Record<string, unknown>;
            if (
              current.purpose !== "ACCOUNT_DELETION_V1" ||
              current.lifecycleRevision !== receipt.lifecycleRevision
            )
              throw new Error(
                "Cleanup receipt does not match committed deletion revision",
              );
            await tx.safetyOperation.update({
              where: { id: receipt.operationId },
              data: {
                requestMetadata: {
                  ...current,
                  phase:
                    receipt.state === "CLEANUP_COMPLETED"
                      ? "CLEANUP_IN_PROGRESS"
                      : "CLEANUP_HELD_RETENTION_REVIEW",
                  profileCleanupState: receipt.state,
                  profileCleanupReceipt: receipt,
                },
              },
            });
            return tx.outboxEvent.updateMany({
              where: { id: row.id, claimToken, deliveredAt: null },
              data: {
                deliveredAt: new Date(),
                terminalAt: new Date(),
                deliveryOutcome: "APPLIED",
                claimedAt: null,
                claimToken: null,
                lastError: null,
              },
            });
          });
        } else {
          const responseEnvelope = this.parseResponseEnvelope(response.body);
          const isValidAuthLifecycleAcknowledgement =
            route.format !== "auth-lifecycle" ||
            (responseEnvelope !== undefined &&
              Object.keys(responseEnvelope).length === 1 &&
              Object.keys(responseEnvelope)[0] === "accepted");
          if (
            responseEnvelope?.accepted !== true ||
            !isValidAuthLifecycleAcknowledgement
          ) {
            throw new Error(`${route.destination} acknowledgement is invalid`);
          }
          const deliveryOutcome =
            responseEnvelope?.stale === true ? "ALREADY_APPLIED" : "APPLIED";
          deliveryUpdate = await this.prisma.outboxEvent.updateMany({
            where: {
              id: row.id,
              claimToken,
              deliveredAt: null,
              terminalAt: null,
            },
            data: {
              deliveredAt: new Date(),
              terminalAt: new Date(),
              deliveryOutcome,
              claimedAt: null,
              claimToken: null,
              lastError: null,
            },
          });
        }
        if (deliveryUpdate.count !== 1) {
          throw new Error("Outbox delivery claim was no longer current");
        }
        this.metrics?.authOutboxDeliveriesTotal.inc({
          event_type: row.eventType,
          outcome: supersededReceipt ? "superseded_by_deletion" : "delivered",
        });
        this.logger.log(
          `${row.eventType} delivery terminal=${supersededReceipt ? "superseded_by_deletion" : "delivered"} eventId=${row.id} attempt=${row.attempts + 1}`,
        );
      } catch (error) {
        if (requestStartedAt !== undefined && !requestLatencyRecorded) {
          this.metrics?.authOutboxDeliveryDurationSeconds.observe(
            { event_type: row.eventType },
            (Date.now() - requestStartedAt) / 1_000,
          );
        }
        const attempts = row.attempts + 1;
        const cappedDelay = Math.min(
          MAX_BACKOFF_MS,
          1_000 * 2 ** Math.min(attempts, 12),
        );
        const delay = Math.max(
          500,
          Math.floor(cappedDelay * (0.5 + Math.random() * 0.5)),
        );
        const message =
          error instanceof Error
            ? error.message.slice(0, 500)
            : "delivery failed";
        await this.prisma.outboxEvent.updateMany({
          where: { id: row.id, claimToken, deliveredAt: null },
          data: {
            claimedAt: null,
            claimToken: null,
            nextAttemptAt: new Date(Date.now() + delay),
            lastError: message,
          },
        });
        const httpStatus =
          error instanceof Error
            ? /^(?:Chat|Profile|Realtime) returned HTTP (\d{3})$/.exec(
                error.message,
              )?.[1]
            : undefined;
        const errorClass = httpStatus
          ? `http_${httpStatus}`
          : error instanceof Error
            ? error.name
            : "unknown";
        this.logger.warn(
          `${row.eventType} delivery retry scheduled eventId=${row.id} attempt=${attempts} errorClass=${errorClass}`,
        );
        this.metrics?.authOutboxDeliveriesTotal.inc({
          event_type: row.eventType,
          outcome: errorClass,
        });
      }
    } catch (error) {
      this.logger.error(
        "Auth outbox delivery poll failed",
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async hasOlderPendingCausalEvent(row: {
    id: string;
    eventType: string;
    aggregateId: string;
    createdAt: Date;
  }): Promise<boolean> {
    const chatIdentityEvent =
      row.eventType === EVENT_TYPE || row.eventType === LIFECYCLE_EVENT_TYPE;
    const results = await this.prisma.$queryRawUnsafe<
      Array<{ blocked: boolean }>
    >(
      `SELECT EXISTS (
         SELECT 1
           FROM chat_profile_provisioning_outbox prior
          WHERE prior.aggregate_id = $1::uuid
            AND prior.delivered_at IS NULL
            AND prior.terminal_at IS NULL
            AND (prior.event_type = $2 OR (
              $3::boolean AND prior.event_type = ANY($4::text[])
            ))
            AND (prior.created_at, prior.id) < ($5::timestamptz, $6::uuid)
       ) AS blocked`,
      row.aggregateId,
      row.eventType,
      chatIdentityEvent,
      [EVENT_TYPE, LIFECYCLE_EVENT_TYPE],
      row.createdAt,
      row.id,
    );
    return results[0]?.blocked === true;
  }

  private parseResponseEnvelope(
    body: string,
  ): Record<string, unknown> | undefined {
    try {
      const parsed = JSON.parse(body) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }

  private validateSupersededReceipt(
    raw: string,
    eventId: string,
    eventType: string,
    payload: unknown,
    secret: string,
  ): boolean {
    const envelope = this.parseResponseEnvelope(raw);
    if (!envelope || !("terminalReceipt" in envelope)) {
      throw new Error("Chat superseded-event receipt binding is invalid");
    }
    const receipt = envelope.terminalReceipt as Record<string, unknown> | null;
    const payloadRecord = payload as Record<string, unknown>;
    const subject = payloadRecord.authUserId;
    if (
      envelope.accepted !== false ||
      !receipt ||
      receipt.eventId !== eventId ||
      receipt.eventType !== eventType ||
      receipt.subject !== subject ||
      receipt.outcome !== "SUPERSEDED_BY_DELETION" ||
      typeof receipt.operationId !== "string" ||
      typeof receipt.lifecycleRevision !== "string" ||
      !/^\d+$/.test(receipt.lifecycleRevision) ||
      typeof receipt.fenceRequestHash !== "string" ||
      typeof receipt.fenceReceiptHash !== "string" ||
      typeof receipt.signature !== "string"
    ) {
      throw new Error("Chat superseded-event receipt binding is invalid");
    }
    const expected = createHmac("sha256", secret)
      .update(
        `chat-outbox.superseded.v1|${eventId}|${eventType}|${String(subject).toLowerCase()}|${receipt.operationId}|${receipt.lifecycleRevision}|${receipt.fenceRequestHash}|${receipt.fenceReceiptHash}`,
      )
      .digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(receipt.signature, "hex");
    } catch {
      throw new Error("Chat superseded-event receipt signature is invalid");
    }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error("Chat superseded-event receipt signature is invalid");
    return true;
  }

  /**
   * Chat's 2xx response is an acknowledgement only when it is the explicit
   * applied result or an exact signed deletion-supersession receipt. A generic
   * HTTP success must never terminalize a durable Auth outbox event.
   */
  private validateChatAcknowledgement(
    raw: string,
    eventId: string,
    eventType: string,
    payload: unknown,
    secret: string,
  ): boolean {
    const envelope = this.parseResponseEnvelope(raw);
    if (!envelope) {
      throw new Error("Chat acknowledgement is invalid");
    }
    if (envelope.accepted === false || "terminalReceipt" in envelope) {
      return this.validateSupersededReceipt(
        raw,
        eventId,
        eventType,
        payload,
        secret,
      );
    }
    if (envelope.accepted !== true) {
      throw new Error("Chat acknowledgement is invalid");
    }
    if (
      Object.keys(envelope).some(
        (key) => key !== "accepted" && key !== "stale",
      ) ||
      ("stale" in envelope && envelope.stale !== true)
    ) {
      throw new Error("Chat acknowledgement is invalid");
    }
    return false;
  }

  private async refreshBacklogMetrics(): Promise<void> {
    if (!this.metrics) return;
    try {
      const now = Date.now();
      const pending = await this.prisma.outboxEvent.groupBy({
        by: ["eventType"],
        where: { deliveredAt: null, terminalAt: null },
        _count: { _all: true },
        _min: { createdAt: true },
      });
      const types = [
        EVENT_TYPE,
        LIFECYCLE_EVENT_TYPE,
        AUTH_LIFECYCLE_EVENT_TYPE,
        ACCOUNT_DELETION_CLEANUP_EVENT,
      ];
      const byType = new Map(pending.map((row) => [row.eventType, row]));
      for (const eventType of types) {
        const row = byType.get(eventType);
        this.metrics.authOutboxPendingEvents.set(
          { event_type: eventType },
          row?._count._all ?? 0,
        );
        this.metrics.authOutboxOldestPendingAgeSeconds.set(
          { event_type: eventType },
          row?._min.createdAt
            ? Math.max(0, (now - row._min.createdAt.getTime()) / 1_000)
            : 0,
        );
      }
    } catch (error) {
      this.logger.warn(
        "Auth outbox backlog metric refresh failed",
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  private postLifecycleEvent(
    endpoint: URL,
    headers: Record<string, string>,
    body: string,
  ): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (
        error?: Error,
        result?: { statusCode: number; body: string },
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve(result ?? { statusCode: 502, body: "" });
      };
      const request = httpsRequest(
        endpoint,
        {
          method: "POST",
          headers,
          // Outbox retries are low-volume and must not reuse a socket after an
          // ambiguous lost response. agent:false gives each attempt a fresh
          // TCP/TLS connection instead of relying on fetch pool recovery.
          agent: false,
        },
        (response) => {
          let responseBody = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            responseBody += chunk.slice(
              0,
              Math.max(0, 16_384 - responseBody.length),
            );
          });
          response.once("end", () =>
            finish(undefined, {
              statusCode: response.statusCode ?? 502,
              body: responseBody,
            }),
          );
          response.once("error", (error) => finish(error));
          response.once("aborted", () =>
            finish(new Error("Chat response ended before acknowledgement")),
          );
        },
      );
      const timeout = setTimeout(
        () => request.destroy(new Error("Chat request timed out")),
        10_000,
      );
      request.once("error", (error) => finish(error));
      request.end(body);
    });
  }

  private validateCleanupReceipt(
    raw: string,
    payload: unknown,
    secret: string,
  ) {
    const request = payload as Record<string, unknown>;
    let receipt: Record<string, unknown>;
    try {
      receipt = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error("Profile cleanup receipt is invalid JSON");
    }
    for (const field of [
      "operationId",
      "subject",
      "requestHash",
      "lifecycleRevision",
    ] as const) {
      if (
        typeof request[field] !== "string" ||
        receipt[field] !== request[field]
      )
        throw new Error(`Profile cleanup receipt ${field} mismatch`);
    }
    if (
      receipt.state !== "CLEANUP_COMPLETED" &&
      receipt.state !== "CLEANUP_HELD_RETENTION_REVIEW"
    )
      throw new Error("Profile cleanup receipt state invalid");
    const expected = createHmac("sha256", secret)
      .update(
        `receipt.cleanup.${receipt.operationId}.${receipt.subject}.${receipt.lifecycleRevision}.${receipt.requestHash}.${receipt.state}`,
      )
      .digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(String(receipt.receiptHash), "hex");
    } catch {
      throw new Error("Profile cleanup receipt signature invalid");
    }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error("Profile cleanup receipt signature invalid");
    return receipt as {
      operationId: string;
      subject: string;
      requestHash: string;
      lifecycleRevision: string;
      state: "CLEANUP_COMPLETED" | "CLEANUP_HELD_RETENTION_REVIEW";
      receiptHash: string;
    };
  }

  private async scheduleInvalidAuthLifecycleEvent(
    eventId: string,
    claimToken: string,
  ): Promise<void> {
    await this.prisma.outboxEvent.updateMany({
      where: { id: eventId, claimToken, deliveredAt: null },
      data: {
        claimedAt: null,
        claimToken: null,
        nextAttemptAt: new Date(Date.now() + MAX_BACKOFF_MS),
        lastError: "invalid auth.lifecycle.v1 event envelope",
      },
    });
    this.logger.error("Invalid auth.lifecycle.v1 event held for inspection");
  }
}
