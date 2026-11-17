import { createHmac, randomUUID } from "crypto";
import { readFileSync } from "fs";
import { IncomingMessage, ServerResponse } from "http";
import { createServer } from "https";
import { AddressInfo } from "net";
import { ChatProfileOutboxWorker } from "./chat-profile-outbox.worker";
import { PrismaService } from "../../prisma/prisma.module";

const enabled =
  process.env.AUTH_LIFECYCLE_OUTBOX_RUN_REAL_DB === "1" &&
  process.env.AUTH_LIFECYCLE_OUTBOX_DISPOSABLE === "true" &&
  Boolean(process.env.DATABASE_URL_AUTH);

(enabled ? describe : describe.skip)(
  "Auth lifecycle outbox HTTPS delivery with PostgreSQL",
  () => {
    const signingSecret =
      "auth-lifecycle-outbox-integration-secret-at-least-32-bytes";
    const subject = randomUUID();
    const eventId = randomUUID();
    const payload = {
      eventId,
      eventType: "auth.lifecycle.v1",
      version: 1,
      subject,
      action: "SESSION_REVOKED",
      scope: "SESSION",
      sessionId: randomUUID(),
      occurredAt: new Date().toISOString(),
    };

    let prisma: PrismaService;
    let connected = false;
    let server: ReturnType<typeof createServer>;
    let worker: ChatProfileOutboxWorker;
    let acknowledgementTrigger: string | undefined;
    let acknowledgementFunction: string | undefined;
    const requests: Array<{
      body: string;
      eventId?: string;
      signature?: string;
      timestamp?: string;
    }> = [];
    let responsesRemaining = 0;
    let config: { get(key: string): string | undefined } | undefined;

    beforeAll(async () => {
      const databaseUrl = process.env.AUTH_LIFECYCLE_OUTBOX_DATABASE_URL;
      if (!databaseUrl) {
        throw new Error(
          "The real outbox test requires its isolated database URL",
        );
      }
      // The shared Jest setup installs a placeholder DATABASE_URL_AUTH. Set
      // this explicitly only inside the fail-closed disposable integration.
      process.env.DATABASE_URL_AUTH = databaseUrl;
      const keyPath = process.env.AUTH_LIFECYCLE_TEST_TLS_KEY;
      const certPath = process.env.AUTH_LIFECYCLE_TEST_TLS_CERT;
      if (!keyPath || !certPath) {
        throw new Error(
          "The real outbox test requires runner-generated TLS key and certificate files",
        );
      }

      prisma = new PrismaService();
      await prisma.$connect();
      connected = true;
      server = createServer(
        {
          key: readFileSync(keyPath),
          cert: readFileSync(certPath),
        },
        (request: IncomingMessage, response: ServerResponse) => {
          const chunks: Buffer[] = [];
          request.on("data", (chunk: Buffer) => chunks.push(chunk));
          request.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            requests.push({
              body,
              eventId: request.headers["x-auth-lifecycle-event-id"] as
                | string
                | undefined,
              signature: request.headers["x-auth-lifecycle-signature"] as
                | string
                | undefined,
              timestamp: request.headers["x-auth-lifecycle-timestamp"] as
                | string
                | undefined,
            });
            response.statusCode = responsesRemaining > 0 ? 503 : 202;
            if (responsesRemaining > 0) responsesRemaining -= 1;
            response.end();
          });
        },
      );
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });

      const address = server.address() as AddressInfo;
      config = {
        get(key: string): string | undefined {
          if (key === "AUTH_LIFECYCLE_URL")
            return `https://127.0.0.1:${address.port}/api/v1/internal/auth/lifecycle`;
          if (key === "AUTH_LIFECYCLE_HMAC_SECRET") return signingSecret;
          return undefined;
        },
      };
      worker = new ChatProfileOutboxWorker(prisma, config as never);
    });

    afterAll(async () => {
      if (connected) {
        if (acknowledgementTrigger) {
          await prisma.$executeRawUnsafe(
            `DROP TRIGGER IF EXISTS "${acknowledgementTrigger}" ON "chat_profile_provisioning_outbox"`,
          );
        }
        if (acknowledgementFunction) {
          await prisma.$executeRawUnsafe(
            `DROP FUNCTION IF EXISTS "${acknowledgementFunction}"()`,
          );
        }
        await prisma.outboxEvent.deleteMany({ where: { id: eventId } });
        await prisma.$disconnect();
      }
      if (server?.listening) {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    });

    it("recovers delivery failures and lost acknowledgements across worker replacements", async () => {
      await prisma.outboxEvent.create({
        data: {
          id: eventId,
          eventType: "auth.lifecycle.v1",
          aggregateId: subject,
          payload,
        },
      });

      // The receiver fails its first real HTTPS request. A replacement worker
      // then retries the same durable event after its scheduled retry time.
      responsesRemaining = 1;
      await worker.deliverOne();

      const failedRow = await prisma.outboxEvent.findUniqueOrThrow({
        where: { id: eventId },
      });
      expect(failedRow.deliveredAt).toBeNull();
      expect(failedRow.attempts).toBe(1);
      expect(failedRow.claimToken).toBeNull();
      expect(failedRow.lastError).toBe("Chat returned HTTP 503");
      expect(requests).toHaveLength(1);

      const suffix = eventId.split("-").join("");
      acknowledgementFunction = `codex_outbox_ack_fail_${suffix}`;
      acknowledgementTrigger = `codex_outbox_ack_fail_trigger_${suffix}`;
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION "${acknowledgementFunction}"() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.id = '${eventId}'::uuid AND NEW.delivered_at IS NOT NULL THEN
            RAISE EXCEPTION 'test injected acknowledgement persistence failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER "${acknowledgementTrigger}"
        BEFORE UPDATE ON "chat_profile_provisioning_outbox"
        FOR EACH ROW EXECUTE FUNCTION "${acknowledgementFunction}"()
      `);
      await prisma.outboxEvent.update({
        where: { id: eventId },
        data: { nextAttemptAt: new Date(Date.now() - 1_000) },
      });
      const replacementWorker = new ChatProfileOutboxWorker(
        prisma,
        config as never,
      );
      await replacementWorker.deliverOne();

      // The receiver accepted the event, but PostgreSQL rejected the delivery
      // acknowledgement. Auth must leave the durable row retryable; the next
      // worker instance may deliver the same event again.
      const unacknowledgedRow = await prisma.outboxEvent.findUniqueOrThrow({
        where: { id: eventId },
      });
      expect(unacknowledgedRow.deliveredAt).toBeNull();
      expect(unacknowledgedRow.attempts).toBe(2);
      expect(unacknowledgedRow.claimToken).toBeNull();
      expect(unacknowledgedRow.lastError).toBeTruthy();
      expect(requests).toHaveLength(2);

      await prisma.$executeRawUnsafe(
        `DROP TRIGGER "${acknowledgementTrigger}" ON "chat_profile_provisioning_outbox"`,
      );
      acknowledgementTrigger = undefined;
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION "${acknowledgementFunction}"()`,
      );
      acknowledgementFunction = undefined;
      await prisma.outboxEvent.update({
        where: { id: eventId },
        data: { nextAttemptAt: new Date(Date.now() - 1_000) },
      });
      const recoveredWorker = new ChatProfileOutboxWorker(
        prisma,
        config as never,
      );
      await recoveredWorker.deliverOne();

      const deliveredRow = await prisma.outboxEvent.findUniqueOrThrow({
        where: { id: eventId },
      });
      expect(deliveredRow.deliveredAt).toBeInstanceOf(Date);
      expect(deliveredRow.attempts).toBe(3);
      expect(requests).toHaveLength(3);
      expect(requests.map((request) => request.eventId)).toEqual([
        eventId,
        eventId,
        eventId,
      ]);
      const replayedEnvelopes = requests.map(
        (request) => JSON.parse(request.body) as unknown,
      );
      expect(replayedEnvelopes).toEqual([payload, payload, payload]);
      for (const request of requests) {
        const expectedSignature = createHmac("sha256", signingSecret)
          .update(`${request.timestamp}.${request.body}`)
          .digest("hex");
        expect(request.signature).toBe(expectedSignature);
      }
    });
  },
);
