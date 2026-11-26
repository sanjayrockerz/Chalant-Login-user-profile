import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { request as httpsRequest } from "node:https";
import { randomUUID, createHmac, timingSafeEqual } from "crypto";
import { AuthSafetyPrismaService, PrismaService } from "../../prisma/prisma.module";
import { ConfigService } from "../config/config.service";
import { AUTH_LIFECYCLE_EVENT_TYPE } from "./auth-lifecycle-event";

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
  private running = false;
  private activeDelivery?: Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly safetyPrisma: AuthSafetyPrismaService,
    private readonly config: ConfigService,
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
    await this.activeDelivery;
  }

  async deliverOne(): Promise<void> {
    if (this.running) return;
    const routeDefinitions = [
      {
        eventType: EVENT_TYPE,
        endpointKey: "CHAT_PROFILE_PROVISIONING_URL",
        secretKey: "CHAT_PROFILE_PROVISIONING_HMAC_SECRET",
        headerPrefix: "x-chat-event",
        format: "chat-envelope" as const,
      },
      {
        eventType: LIFECYCLE_EVENT_TYPE,
        endpointKey: "CHAT_ACCOUNT_LIFECYCLE_URL",
        secretKey: "CHAT_PROFILE_PROVISIONING_HMAC_SECRET",
        headerPrefix: "x-chat-event",
        format: "chat-envelope" as const,
      },
      {
        eventType: AUTH_LIFECYCLE_EVENT_TYPE,
        endpointKey: "AUTH_LIFECYCLE_URL",
        secretKey: "AUTH_LIFECYCLE_HMAC_SECRET",
        headerPrefix: "x-auth-lifecycle",
        format: "auth-lifecycle" as const,
      },
      {
        eventType: ACCOUNT_DELETION_CLEANUP_EVENT,
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
          headerPrefix: route.headerPrefix,
          format: route.format,
        });
      } catch {
        this.logger.error(`Endpoint for ${route.eventType} must use HTTPS`);
      }
    }
    if (routeByType.size === 0) return;

    this.running = true;
    const delivery = this.deliverClaimedEvent(routeByType);
    this.activeDelivery = delivery;
    try {
      await delivery;
    } finally {
      if (this.activeDelivery === delivery) this.activeDelivery = undefined;
      this.running = false;
    }
  }

  private async deliverClaimedEvent(
    routeByType: Map<
      string,
      {
        endpoint: URL;
        secret: string;
        headerPrefix: string;
        format: "auth-lifecycle" | "chat-envelope" | "account-deletion-cleanup";
      }
    >,
  ): Promise<void> {
    try {
      const now = new Date();
      const row = await this.prisma.outboxEvent.findFirst({
        where: {
          eventType: { in: [...routeByType.keys()] },
          deliveredAt: null,
          nextAttemptAt: { lte: now },
          OR: [
            { claimedAt: null },
            { claimedAt: { lt: new Date(now.getTime() - LEASE_MS) } },
          ],
        },
        orderBy: { createdAt: "asc" },
      });
      if (!row) return;

      const route = routeByType.get(row.eventType);
      if (!route) return;

      const claimToken = randomUUID();
      const claimed = await this.prisma.outboxEvent.updateMany({
        where: {
          id: row.id,
          deliveredAt: null,
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
        const response = await this.postLifecycleEvent(
          route.endpoint,
          headers,
          body,
        );
        if (response.statusCode < 200 || response.statusCode >= 300)
          throw new Error(
            `${route.format === "account-deletion-cleanup" ? "Profile" : "Chat"} returned HTTP ${response.statusCode}`,
          );
        let deliveryUpdate: { count: number };
        if (route.format === "account-deletion-cleanup") {
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
                claimedAt: null,
                claimToken: null,
                lastError: null,
              },
            });
          });
        } else {
          deliveryUpdate = await this.prisma.outboxEvent.updateMany({
            where: { id: row.id, claimToken, deliveredAt: null },
            data: {
              deliveredAt: new Date(),
              claimedAt: null,
              claimToken: null,
              lastError: null,
            },
          });
        }
        if (deliveryUpdate.count !== 1) {
          throw new Error("Outbox delivery claim was no longer current");
        }
        this.logger.log(
          `${row.eventType} delivery acknowledged eventId=${row.id} attempt=${row.attempts + 1}`,
        );
      } catch (error) {
        const attempts = row.attempts + 1;
        const delay = Math.min(
          MAX_BACKOFF_MS,
          1_000 * 2 ** Math.min(attempts, 12),
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
            ? /^(?:Chat|Profile) returned HTTP (\d{3})$/.exec(
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
      }
    } catch (error) {
      this.logger.error(
        "Chat provisioning outbox poll failed",
        error instanceof Error ? error.stack : undefined,
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
