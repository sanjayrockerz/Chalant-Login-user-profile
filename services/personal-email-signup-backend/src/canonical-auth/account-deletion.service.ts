import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ConfigService } from "../config/config.service";
import { PrismaService } from "../../prisma/prisma.module";
import { SafetyOrderingService } from "../safety-ordering/safety-ordering.service";
import { AuthAccountDeletionFenceClient } from "./account-deletion-fence.client";
import { AUTH_LIFECYCLE_EVENT_TYPE } from "./auth-lifecycle-event";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface DeletionFenceReceipt {
  operationId: string;
  subject: string;
  requestHash: string;
  lifecycleRevision: string;
  state: "FENCED";
  receiptHash: string;
}

export interface AccountDeletionFenceClient {
  prepareProfile(
    subject: string,
    operationId: string,
    requestHash: string,
    lifecycleRevision: string,
  ): Promise<DeletionFenceReceipt>;
  prepareChat(
    subject: string,
    operationId: string,
    requestHash: string,
    lifecycleRevision: string,
  ): Promise<DeletionFenceReceipt>;
  prepareRealtime(
    subject: string,
    operationId: string,
    requestHash: string,
    lifecycleRevision: string,
  ): Promise<DeletionFenceReceipt>;
}

@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyOrderingService,
    @Inject(AuthAccountDeletionFenceClient)
    private readonly fences: AccountDeletionFenceClient,
    @Inject(ConfigService)
    private readonly config: Pick<ConfigService, "get">,
  ) {}

  async requestDeletion(
    subject: string,
    operationId: string,
  ): Promise<{
    operationId: string;
    state:
      | "PENDING"
      | "CLEANUP_IN_PROGRESS"
      | "CLEANUP_COMPLETED"
      | "CLEANUP_HELD_RETENTION_REVIEW";
    lifecycleRevision?: string;
  }> {
    const canonicalSubject = this.uuid(subject, "account subject");
    const canonicalOperationId = this.uuid(operationId, "idempotency key");
    if (this.config.get("AUTH_ACCOUNT_DELETION_ENABLED") !== true) {
      throw new ServiceUnavailableException("Account deletion is not enabled");
    }

    const commandHash = this.requestHash(
      canonicalSubject,
      canonicalOperationId,
    );
    const existing = await this.prisma.accountDeletionTombstone.findUnique({
      where: { authSubject: canonicalSubject },
      select: { lifecycleRevision: true },
    });
    if (existing) {
      const retry = await this.getAcceptedRetry(
        canonicalSubject,
        canonicalOperationId,
      );
      if (!retry) {
        throw new ConflictException(
          "Account deletion was already accepted under a different operation",
        );
      }
      return retry;
    }

    const operation = await this.safety.beginAccountDeletion({
      operationId: canonicalOperationId,
      subjectId: canonicalSubject,
      commandHash,
    });
    if (operation.state !== "HELD" && operation.state !== "RECOVERY_REQUIRED") {
      if (operation.state === "FINALIZED") {
        const tombstone = await this.prisma.accountDeletionTombstone.findUnique(
          {
            where: { authSubject: canonicalSubject },
            select: { lifecycleRevision: true },
          },
        );
        if (!tombstone) {
          throw new ServiceUnavailableException(
            "Finalized deletion operation has no permanent tombstone",
          );
        }
        return {
          operationId: canonicalOperationId,
          state: "CLEANUP_IN_PROGRESS",
          lifecycleRevision: tombstone.lifecycleRevision.toString(),
        };
      }
      return { operationId: canonicalOperationId, state: "PENDING" };
    }

    // One request per subject owns the bounded downstream fence workflow at a
    // time, including across Auth instances. This transaction-scoped advisory
    // lock is only a work coalescer: the durable SOC account resource remains
    // held until the existing source receipt/tombstone transaction commits.
    // If the process dies, PostgreSQL releases the advisory lock and a retry
    // recovers from the same durable SOC operation and source receipts.
    return this.prisma.$transaction(async (lockTx) => {
      const lockRows = await lockTx.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_xact_lock(
        hashtextextended(${`auth-account-deletion:${canonicalSubject}`}, 684202611)
      ) AS acquired
    `;
      if (!lockRows[0]?.acquired) {
        return { operationId: canonicalOperationId, state: "PENDING" as const };
      }

      const currentUser = await this.prisma.user.findUnique({
        where: { id: canonicalSubject },
        select: { accountStatusVersion: true },
      });
      if (!currentUser) throw new NotFoundException("Account not found");
      const lifecycleRevision = String(currentUser.accountStatusVersion + 1);
      const fenceReceipts = await Promise.all([
        this.fences.prepareProfile(
          canonicalSubject,
          canonicalOperationId,
          commandHash,
          lifecycleRevision,
        ),
        this.fences.prepareChat(
          canonicalSubject,
          canonicalOperationId,
          commandHash,
          lifecycleRevision,
        ),
        this.fences.prepareRealtime(
          canonicalSubject,
          canonicalOperationId,
          commandHash,
          lifecycleRevision,
        ),
      ]);
      for (const receipt of fenceReceipts) {
        if (
          receipt.operationId !== canonicalOperationId ||
          receipt.subject.toLowerCase() !== canonicalSubject ||
          receipt.requestHash !== commandHash ||
          receipt.lifecycleRevision !== lifecycleRevision ||
          receipt.state !== "FENCED" ||
          !/^[a-f0-9]{64}$/i.test(receipt.receiptHash)
        ) {
          throw new ConflictException(
            "Deletion safety fence receipt is invalid",
          );
        }
      }
      const durableFenceReceipts = JSON.parse(
        JSON.stringify(fenceReceipts),
      ) as Prisma.InputJsonValue;

      const accepted = await this.safety.runAccountMutation({
        operationId: canonicalOperationId,
        subjectId: canonicalSubject,
        commandHash,
        commit: async (tx) => {
          const prior = await tx.accountDeletionTombstone.findUnique({
            where: { authSubject: canonicalSubject },
            select: { lifecycleRevision: true },
          });
          if (prior) {
            return {
              operationId: canonicalOperationId,
              state: "ACCEPTED" as const,
              lifecycleRevision: prior.lifecycleRevision.toString(),
            };
          }
          const user = await tx.user.findUnique({
            where: { id: canonicalSubject },
            select: { id: true, accountStatusVersion: true },
          });
          if (!user) throw new NotFoundException("Account not found");

          const committedLifecycleRevision = BigInt(
            user.accountStatusVersion + 1,
          );
          if (committedLifecycleRevision.toString() !== lifecycleRevision) {
            throw new ConflictException(
              "Account lifecycle revision changed while deletion was held",
            );
          }
          await tx.accountDeletionTombstone.create({
            data: {
              authSubject: canonicalSubject,
              lifecycleRevision: committedLifecycleRevision,
            },
          });
          await tx.refreshToken.deleteMany({
            where: { userId: canonicalSubject },
          });
          const lifecycleEvent = {
            eventId: canonicalOperationId,
            eventType: AUTH_LIFECYCLE_EVENT_TYPE,
            version: 1,
            subject: canonicalSubject,
            action: "ACCOUNT_DELETED",
            scope: "ACCOUNT",
            operationId: canonicalOperationId,
            requestHash: commandHash,
            occurredAt: new Date().toISOString(),
            lifecycleRevision: committedLifecycleRevision.toString(),
          };
          await tx.outboxEvent.create({
            data: {
              id: lifecycleEvent.eventId,
              eventType: AUTH_LIFECYCLE_EVENT_TYPE,
              aggregateId: canonicalSubject,
              payload: lifecycleEvent,
            },
          });
          await tx.outboxEvent.create({
            data: {
              eventType: "auth.account.deletion.cleanup.v1",
              aggregateId: canonicalSubject,
              payload: {
                eventType: "auth.account.deletion.cleanup.v1",
                operationId: canonicalOperationId,
                subject: canonicalSubject,
                requestHash: commandHash,
                lifecycleRevision: committedLifecycleRevision.toString(),
              },
            },
          });
          await tx.user.delete({ where: { id: canonicalSubject } });
          await tx.safetyOperation.update({
            where: { id: canonicalOperationId },
            data: {
              requestMetadata: {
                purpose: "ACCOUNT_DELETION_V1",
                phase: "CLEANUP_IN_PROGRESS",
                fenceReceipts: durableFenceReceipts,
                lifecycleRevision: committedLifecycleRevision.toString(),
              },
            },
          });
          return {
            operationId: canonicalOperationId,
            state: "CLEANUP_IN_PROGRESS" as const,
            lifecycleRevision: committedLifecycleRevision.toString(),
          };
        },
      });
      return accepted as {
        operationId: string;
        state: "CLEANUP_IN_PROGRESS";
        lifecycleRevision: string;
      };
    });
  }

  /**
   * Resume durable pre-tombstone deletions after transport failure, disconnect,
   * or Auth restart. The same operation identity and existing SOC resource are
   * reused; downstream fences are idempotent, and the tombstone transaction is
   * still reachable only after every signed receipt validates.
   */
  async recoverPendingDeletions(limit = 25): Promise<number> {
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const pending = await this.prisma.$queryRaw<
      Array<{ operationId: string; subject: string }>
    >`
      SELECT id::text AS "operationId", subjects[1]::text AS subject
      FROM safety_operations
      WHERE operation_type = 'ACCOUNT_MUTATION'
        AND caller_service_id = 'auth-account-lifecycle'
        AND state IN ('REQUESTED', 'HELD', 'RECOVERY_REQUIRED')
        AND request_metadata->>'purpose' = 'ACCOUNT_DELETION_V1'
        AND request_metadata->>'phase' = 'PREPARING'
      ORDER BY updated_at ASC, created_at ASC
      LIMIT ${boundedLimit}
    `;
    let attempted = 0;
    for (const operation of pending) {
      if (
        !UUID_PATTERN.test(operation.operationId) ||
        !UUID_PATTERN.test(operation.subject)
      )
        continue;
      attempted += 1;
      try {
        const outcome = await this.requestDeletion(
          operation.subject,
          operation.operationId,
        );
        this.logger.log(
          JSON.stringify({
            event: "account_deletion.recovery_attempt_completed",
            timestamp: new Date().toISOString(),
            operationId: operation.operationId,
            state: outcome.state,
          }),
        );
      } catch (error) {
        // Keep the SOC operation held. The next bounded poll reuses its exact
        // operation ID; never release an ambiguous fence on timeout.
        const errorName = error instanceof Error ? error.name : "UnknownError";
        this.logger.warn(
          JSON.stringify({
            event: "account_deletion.recovery_attempt_failed",
            operationId: operation.operationId,
            errorName,
          }),
        );
      }
    }
    return attempted;
  }

  async getAcceptedRetry(
    subject: string,
    operationId: string,
  ): Promise<{
    operationId: string;
    state:
      | "PENDING"
      | "CLEANUP_IN_PROGRESS"
      | "CLEANUP_COMPLETED"
      | "CLEANUP_HELD_RETENTION_REVIEW";
    lifecycleRevision?: string;
  } | null> {
    const canonicalSubject = this.uuid(subject, "account subject");
    const canonicalOperationId = this.uuid(operationId, "idempotency key");
    const commandHash = this.requestHash(
      canonicalSubject,
      canonicalOperationId,
    );
    const tombstone = await this.prisma.accountDeletionTombstone.findUnique({
      where: { authSubject: canonicalSubject },
      select: { lifecycleRevision: true },
    });
    const operation = await this.prisma.safetyOperation.findUnique({
      where: { id: canonicalOperationId },
      select: {
        requestHash: true,
        operationType: true,
        callerServiceId: true,
        subjects: true,
        resourceKeys: true,
        requestMetadata: true,
        state: true,
      },
    });
    const expectedSocRequestHash = createHash("sha256")
      .update(
        JSON.stringify({
          callerId: "auth-account-lifecycle",
          type: "ACCOUNT_MUTATION",
          subjects: [canonicalSubject],
          resourceKeys: [`account:${canonicalSubject}`],
          commandHash,
        }),
      )
      .digest("hex");
    const metadata = operation?.requestMetadata;
    const purpose =
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>).purpose
        : undefined;
    const phase =
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>).phase
        : undefined;
    if (
      !operation ||
      operation.requestHash !== expectedSocRequestHash ||
      operation.operationType !== "ACCOUNT_MUTATION" ||
      operation.callerServiceId !== "auth-account-lifecycle" ||
      JSON.stringify(operation.resourceKeys) !==
        JSON.stringify([`account:${canonicalSubject}`]) ||
      !operation.subjects.some(
        (value) => value.toLowerCase() === canonicalSubject,
      ) ||
      purpose !== "ACCOUNT_DELETION_V1"
    )
      return null;
    if (!tombstone) {
      if (
        phase !== "PREPARING" ||
        !["REQUESTED", "HELD", "RECOVERY_REQUIRED"].includes(operation.state)
      )
        return null;
      return { operationId: canonicalOperationId, state: "PENDING" };
    }
    if (
      ![
        "CLEANUP_IN_PROGRESS",
        "CLEANUP_COMPLETED",
        "CLEANUP_HELD_RETENTION_REVIEW",
      ].includes(String(phase)) ||
      operation.state !== "FINALIZED"
    )
      return null;
    return {
      operationId: canonicalOperationId,
      state: phase as
        | "CLEANUP_IN_PROGRESS"
        | "CLEANUP_COMPLETED"
        | "CLEANUP_HELD_RETENTION_REVIEW",
      lifecycleRevision: tombstone.lifecycleRevision.toString(),
    };
  }

  private requestHash(subject: string, operationId: string): string {
    return createHash("sha256")
      .update(
        JSON.stringify(["auth-account-deletion-v1", subject, operationId]),
      )
      .digest("hex");
  }

  private uuid(value: string, label: string): string {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
      throw new BadRequestException(`${label} must be a UUID`);
    }
    return value.toLowerCase();
  }
}
