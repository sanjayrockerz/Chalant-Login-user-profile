import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { request as httpsRequest } from "node:https";
import { randomUUID, createHmac } from "crypto";
import { PrismaService } from "../../prisma/prisma.module";
import { ConfigService } from "../config/config.service";
import { AUTH_LIFECYCLE_EVENT_TYPE } from "./auth-lifecycle-event";

const EVENT_TYPE = "chat.profile.provision.v1";
const LIFECYCLE_EVENT_TYPE = "chat.account.lifecycle.v1";
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
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const chatSecret = this.config.get("CHAT_PROFILE_PROVISIONING_HMAC_SECRET");
    const authSecret = this.config.get("AUTH_LIFECYCLE_HMAC_SECRET");
    if (!chatSecret && !authSecret) {
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
    ] as const;
    const routeByType = new Map<
      string,
      {
        endpoint: URL;
        secret: string;
        headerPrefix: string;
        format: "chat-envelope" | "auth-lifecycle";
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
        format: "auth-lifecycle" | "chat-envelope";
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
        route.format === "auth-lifecycle"
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
        const statusCode = await this.postLifecycleEvent(
          route.endpoint,
          headers,
          body,
        );
        if (statusCode < 200 || statusCode >= 300)
          throw new Error(`Chat returned HTTP ${statusCode}`);
        const deliveryUpdate = await this.prisma.outboxEvent.updateMany({
          where: { id: row.id, claimToken, deliveredAt: null },
          data: {
            deliveredAt: new Date(),
            claimedAt: null,
            claimToken: null,
            lastError: null,
          },
        });
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
            ? /^Chat returned HTTP (\d{3})$/.exec(error.message)?.[1]
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
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, statusCode?: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve(statusCode ?? 502);
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
          response.resume();
          response.once("end", () =>
            finish(undefined, response.statusCode ?? 502),
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
