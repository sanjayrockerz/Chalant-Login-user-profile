import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { randomUUID, createHmac } from "crypto";
import { PrismaService } from "../../prisma/prisma.module";
import { ConfigService } from "../config/config.service";

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const secret = this.config.get("CHAT_PROFILE_PROVISIONING_HMAC_SECRET");
    if (!secret) {
      this.logger.warn("Chat event delivery is not configured");
      return;
    }
    this.timer = setInterval(() => void this.deliverOne(), POLL_INTERVAL_MS);
    this.timer.unref();
    void this.deliverOne();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async deliverOne(): Promise<void> {
    if (this.running) return;
    const secret = this.config.get("CHAT_PROFILE_PROVISIONING_HMAC_SECRET");
    if (!secret) return;

    this.running = true;
    try {
      const now = new Date();
      const row = await this.prisma.outboxEvent.findFirst({
        where: {
          eventType: { in: [EVENT_TYPE, LIFECYCLE_EVENT_TYPE] },
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

      const eventUrl =
        row.eventType === LIFECYCLE_EVENT_TYPE
          ? this.config.get("CHAT_ACCOUNT_LIFECYCLE_URL")
          : this.config.get("CHAT_PROFILE_PROVISIONING_URL");
      if (!eventUrl) return;
      let eventTarget: URL;
      try {
        eventTarget = new URL(eventUrl);
        if (eventTarget.protocol !== "https:")
          throw new Error("HTTPS required");
      } catch {
        this.logger.error("Chat event endpoint must use HTTPS");
        return;
      }

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

      const body = JSON.stringify({
        eventId: row.id,
        eventType: row.eventType,
        payload: row.payload,
      });
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = createHmac("sha256", secret)
        .update(`${timestamp}.${body}`)
        .digest("hex");
      try {
        const response = await fetch(eventTarget, {
          method: "POST",
          redirect: "error",
          headers: {
            "content-type": "application/json",
            "x-chat-event-timestamp": timestamp,
            "x-chat-event-signature": signature,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok)
          throw new Error(`Chat returned HTTP ${response.status}`);
        await this.prisma.outboxEvent.updateMany({
          where: { id: row.id, claimToken, deliveredAt: null },
          data: {
            deliveredAt: new Date(),
            claimedAt: null,
            claimToken: null,
            lastError: null,
          },
        });
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
        this.logger.warn(
          `Chat provisioning delivery failed; retry scheduled (${attempts})`,
        );
      }
    } catch (error) {
      this.logger.error(
        "Chat provisioning outbox poll failed",
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }
}
