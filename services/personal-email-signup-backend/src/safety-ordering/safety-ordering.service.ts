import {
  ConflictException,
  ForbiddenException,
  Injectable,
  OnModuleInit,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  Prisma,
  SafetyOperationState,
  SafetyOperationType,
} from "@prisma/client";
import { createHash, createPrivateKey } from "crypto";
import * as jwt from "jsonwebtoken";
import { AuthSafetyPrismaService } from "../../prisma/prisma.module";
import {
  CreateSafetyOperationDto,
  DisclosureReservationDto,
  MatchReservationDto,
  SafetyReceiptDto,
} from "./safety-ordering.dto";
import { b2c9TestFaultPoint } from "./b2c9-test-fault";
import { ProfilePairStateClient } from "./profile-pair-state.client";
import {
  ChatMatchJournalClient,
  ChatMatchOperationBinding,
} from "./chat-match-journal.client";

const ACTIVE_STATES: SafetyOperationState[] = [
  "REQUESTED",
  "HELD",
  "CHECKED",
  "CHAT_COMMITTED",
  "CHAT_ABORTED",
  "SOURCE_COMMITTED",
  "CHAT_PAIR_TERMINATED",
  "RECOVERY_REQUIRED",
];
const TRANSACTION_OPTIONS = { maxWait: 1_000, timeout: 3_000 };

export interface SafetyCaller {
  id: string;
  audience: string;
  scope: string;
}

export interface AuthAccountMutation {
  operationId: string;
  subjectId: string;
  commandHash: string;
  commit: (tx: Prisma.TransactionClient) => Promise<unknown>;
}

interface ResourceSnapshot {
  resource_key: string;
  owner_operation_id: string | null;
  fence_epoch: bigint;
}

interface WaiterSnapshot {
  operation_id: string;
  resource_key: string;
  ticket: bigint;
}

@Injectable()
export class SafetyOrderingService implements OnModuleInit {
  constructor(
    private readonly prisma: AuthSafetyPrismaService,
    @Optional() private readonly profilePairState?: ProfilePairStateClient,
    @Optional() private readonly chatMatchJournal?: ChatMatchJournalClient,
  ) {}

  onModuleInit(): void {
    if (!this.disclosureEnabled()) return;
    const privateKey = process.env.AUTH_DISCLOSURE_PERMIT_PRIVATE_KEY?.replace(
      /\\n/g,
      "\n",
    );
    if (!privateKey) {
      throw new ServiceUnavailableException(
        "AUTH_DISCLOSURE_PERMIT_PRIVATE_KEY is required when DISCLOSURE is enabled",
      );
    }
    try {
      createPrivateKey(privateKey);
    } catch {
      throw new ServiceUnavailableException(
        "AUTH_DISCLOSURE_PERMIT_PRIVATE_KEY is invalid",
      );
    }
  }

  async runAccountMutation<T>(input: AuthAccountMutation): Promise<T> {
    if (!/^[a-f0-9]{64}$/i.test(input.commandHash)) {
      throw new UnprocessableEntityException(
        "A canonical account mutation hash is required",
      );
    }
    const caller: SafetyCaller = {
      id: "auth-account-lifecycle",
      audience: "auth-safety-ordering",
      scope: "safety:operations:request",
    };
    const operation = await this.createOrGet(caller, {
      operationId: input.operationId,
      type: "ACCOUNT_MUTATION",
      subjects: [input.subjectId],
      commandHash: input.commandHash,
    });
    const resourceKey = `account:${input.subjectId.toLowerCase()}`;
    if (operation.state === "FINALIZED") {
      await this.advanceWaiters([resourceKey]);
      const receipt = operation.sourceReceipt;
      if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
        throw new ServiceUnavailableException(
          "Finalized account mutation is missing its durable result",
        );
      }
      const result = (receipt as Record<string, unknown>).result;
      if (result === undefined) {
        throw new ServiceUnavailableException(
          "Finalized account mutation is missing its durable result",
        );
      }
      return result as T;
    }
    if (operation.state !== "HELD" && operation.state !== "RECOVERY_REQUIRED") {
      throw new ConflictException(
        "Account mutation is durably waiting for its SOC resource",
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const resources = await this.lockResources(tx, [resourceKey]);
      const locked = await this.lockOperation(tx, input.operationId);
      const stored = await tx.safetyOperation.findUnique({
        where: { id: input.operationId },
      });
      if (!stored) throw new NotFoundException("Safety operation not found");
      if (locked.state === "FINALIZED") {
        const receipt = stored.sourceReceipt;
        if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
          throw new ServiceUnavailableException(
            "Finalized account mutation is missing its durable result",
          );
        }
        const priorResult = (receipt as Record<string, unknown>).result;
        if (priorResult === undefined) {
          throw new ServiceUnavailableException(
            "Finalized account mutation is missing its durable result",
          );
        }
        return priorResult as T;
      }
      if (
        (locked.state !== "HELD" && locked.state !== "RECOVERY_REQUIRED") ||
        stored.operationType !== "ACCOUNT_MUTATION" ||
        stored.callerServiceId !== caller.id ||
        resources.length !== 1 ||
        resources[0].owner_operation_id !== input.operationId
      ) {
        throw new ConflictException(
          "Account mutation no longer owns its SOC fence",
        );
      }
      const fenceEpoch = this.jsonRecord(stored.fenceEpochs)[resourceKey];
      if (!fenceEpoch || resources[0].fence_epoch.toString() !== fenceEpoch) {
        throw new ConflictException("Account mutation fence epoch is stale");
      }

      await tx.$executeRaw`SELECT set_config('app.safety_operation_id', ${input.operationId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.safety_fence_epoch', ${fenceEpoch}, true)`;
      await b2c9TestFaultPoint(
        "auth.account-mutation.locked.before-source-commit",
        input.operationId,
      );
      const mutationResult = await input.commit(tx);
      await b2c9TestFaultPoint(
        "auth.account-mutation.source-written.before-soc-terminal",
        input.operationId,
      );
      const transactionRows = await tx.$queryRaw<
        Array<{ transaction_id: string; committed_at: Date }>
      >`SELECT txid_current()::text AS transaction_id, clock_timestamp() AS committed_at`;
      const receipt = {
        receiptId: input.operationId,
        operationId: input.operationId,
        resourceKeys: [resourceKey],
        kind: "AUTH_SOURCE_COMMITTED",
        transactionId: transactionRows[0].transaction_id,
        payloadHash: stored.requestHash,
        fenceEpochs: { [resourceKey]: fenceEpoch },
        committedAt: transactionRows[0].committed_at.toISOString(),
        // JSON persistence omits `undefined`, which made successful void
        // mutations impossible to replay from their finalized SOC receipt.
        // Persist an explicit null sentinel so duplicate/recovery calls can
        // return the original terminal result without re-running the writer.
        result: mutationResult === undefined ? null : mutationResult,
      };
      await tx.safetyOperation.update({
        where: { id: input.operationId },
        data: {
          state: "SOURCE_COMMITTED",
          sourceReceipt: this.jsonValue(receipt),
          sourceRevisions: this.jsonValue({
            [input.subjectId.toLowerCase()]:
              this.resultRevision(mutationResult),
          }),
        },
      });
      await tx.safetyOperation.update({
        where: { id: input.operationId },
        data: { state: "FINALIZED" },
      });
      await this.releaseOwnedResources(tx, input.operationId, [resourceKey]);
      return mutationResult as T;
    }, TRANSACTION_OPTIONS);
    await b2c9TestFaultPoint(
      "auth.account-mutation.committed.before-response",
      input.operationId,
    );
    await this.advanceWaiters([resourceKey]);
    return result;
  }

  async createOrGet(caller: SafetyCaller, input: CreateSafetyOperationDto) {
    if (input.type === "MATCH" || input.type === "DISCLOSURE") {
      throw new ServiceUnavailableException(
        "Matching and disclosure permits require their dedicated source-check contracts",
      );
    }
    return this.createOperation(caller, input);
  }

  /**
   * Enqueues irreversible deletion on the same account resource used by
   * MATCH, DISCLOSURE and account mutations. The durable request metadata lets
   * Auth deny new credentials while the operation waits or recovers.
   */
  async beginAccountDeletion(input: {
    operationId: string;
    subjectId: string;
    commandHash: string;
  }) {
    const caller: SafetyCaller = {
      id: "auth-account-lifecycle",
      audience: "auth-safety-ordering",
      scope: "safety:operations:request",
    };
    return this.createOperation(
      caller,
      {
        operationId: input.operationId,
        type: "ACCOUNT_MUTATION",
        subjects: [input.subjectId],
        commandHash: input.commandHash,
      },
      { purpose: "ACCOUNT_DELETION_V1", phase: "PREPARING" },
    );
  }

  async reserveMatch(caller: SafetyCaller, input: MatchReservationDto) {
    const commitmentTestEnabled = this.matchCommitmentTestEnabled();
    const productionMatchEnabled = this.matchProductionEnabled();
    if (
      caller.id !== "chat-backend-service" ||
      caller.scope !== "safety:operations:match:reserve"
    ) {
      throw new ForbiddenException("Chat MATCH reservation scope is required");
    }
    if (!this.matchTestSourceCheckEnabled() && !productionMatchEnabled) {
      throw new ServiceUnavailableException(
        "MATCH source checking is disabled or incompletely configured",
      );
    }
    if (!this.profilePairState) {
      throw new ServiceUnavailableException(
        "Authoritative Profile pair-state client is unavailable",
      );
    }

    const participants = input.participants
      .map((participant) => ({
        authSubject: participant.authSubject.toLowerCase(),
        searchId: participant.searchId.toLowerCase(),
        originatingSessionId: participant.originatingSessionId.toLowerCase(),
        generation: BigInt(participant.generation).toString(),
      }))
      .sort((left, right) => left.authSubject.localeCompare(right.authSubject));
    const subjects = participants.map(({ authSubject }) => authSubject);
    if (
      new Set(subjects).size !== 2 ||
      new Set(participants.map(({ searchId }) => searchId)).size !== 2
    ) {
      throw new UnprocessableEntityException(
        "MATCH requires distinct Auth subjects and search identities",
      );
    }
    if (!this.chatMatchJournal) {
      throw new ServiceUnavailableException(
        "Chat durable proposal source is unavailable",
      );
    }
    let proposalParticipants;
    try {
      proposalParticipants = await this.chatMatchJournal.inspectProposal(
        input.proposalId.toLowerCase(),
      );
    } catch {
      throw new ServiceUnavailableException(
        "Chat durable proposal binding cannot be verified",
      );
    }
    const canonicalProposalParticipants = proposalParticipants
      .map((participant) => ({
        authSubject: participant.authSubject.toLowerCase(),
        searchId: participant.searchId.toLowerCase(),
        generation: BigInt(participant.generation).toString(),
        originatingSessionId: participant.originatingSessionId.toLowerCase(),
      }))
      .sort((left, right) => left.authSubject.localeCompare(right.authSubject));
    if (
      this.stableJson(canonicalProposalParticipants) !==
      this.stableJson(participants)
    ) {
      throw new ConflictException(
        "MATCH request does not use the proposal's originating Auth sessions",
      );
    }
    const metadata = {
      proposalId: input.proposalId.toLowerCase(),
      chatOperationId: input.chatOperationId.toLowerCase(),
      participants,
      policyState: commitmentTestEnabled
        ? "OWNER_APPROVED_SOURCE_CHECK_TEST_ONLY"
        : "OWNER_APPROVED_SOURCE_CHECK_AND_MATCH_COMMITMENT_V1",
      eligibilityPolicy: "VERIFIED_ACTIVE_ACCOUNT_AND_ORIGINATING_SESSION_V1",
    };
    const commandHash = createHash("sha256")
      .update(this.stableJson(metadata))
      .digest("hex");
    const operation = await this.createOperation(
      caller,
      {
        operationId: input.operationId,
        type: "MATCH",
        subjects,
        commandHash,
      },
      metadata,
    );

    if (operation.state === "CHECKED") {
      return this.matchSourceCheckResult(
        operation,
        true,
        commitmentTestEnabled || productionMatchEnabled,
      );
    }
    if (operation.state !== "HELD" && operation.state !== "RECOVERY_REQUIRED") {
      return {
        ...operation,
        sourceCheckStatus:
          operation.state === "REQUESTED" ? "WAITING" : "NOT_CHECKED",
        sourceCheckPassed: false,
        permitIssued: false,
        testOnly: true,
      };
    }

    await b2c9TestFaultPoint(
      "auth.match.held.before-source-check",
      input.operationId,
    );

    let accountRows: Array<{
      id: string;
      accountStatus: string;
      accountStatusVersion: number;
      isVerified: boolean;
    }>;
    let sessionRows: Array<{
      id: string;
      userId: string;
      revokedAt: Date | null;
      expiresAt: Date;
    }>;
    let pairState;
    try {
      accountRows = await this.prisma.user.findMany({
        where: { id: { in: subjects } },
        select: {
          id: true,
          accountStatus: true,
          accountStatusVersion: true,
          isVerified: true,
        },
      });
      sessionRows = await this.prisma.identitySession.findMany({
        where: {
          id: {
            in: participants.map(
              ({ originatingSessionId }) => originatingSessionId,
            ),
          },
        },
        select: { id: true, userId: true, revokedAt: true, expiresAt: true },
      });
      pairState = await this.profilePairState.readPairState(
        subjects[0],
        subjects[1],
      );
    } catch {
      await this.markMatchSourceUnavailable(input.operationId);
      throw new ServiceUnavailableException(
        "MATCH source state is unavailable; held resources remain fenced",
      );
    }

    await b2c9TestFaultPoint(
      "auth.match.sources-read.before-checked-transaction",
      input.operationId,
    );

    const accounts = new Map(
      accountRows.map((row) => [row.id.toLowerCase(), row]),
    );
    const sessions = new Map(
      sessionRows.map((row) => [row.id.toLowerCase(), row]),
    );
    const now = new Date();
    const eligibleOriginSessions = participants.every((participant) => {
      const session = sessions.get(participant.originatingSessionId);
      return (
        session?.userId.toLowerCase() === participant.authSubject &&
        session.revokedAt === null &&
        session.expiresAt > now
      );
    });
    if (
      accounts.size !== 2 ||
      subjects.some(
        (subject) =>
          accounts.get(subject)?.accountStatus !== "ACTIVE" ||
          accounts.get(subject)?.isVerified !== true,
      )
    ) {
      const denied = await this.denyMatchReservation(
        caller,
        operation,
        "ACCOUNT_NOT_ACTIVE_VERIFIED_OR_UNKNOWN",
      );
      return {
        ...denied,
        sourceCheckStatus: "DENIED",
        sourceCheckPassed: false,
        permitIssued: false,
        testOnly: true,
      };
    }
    if (!eligibleOriginSessions) {
      const denied = await this.denyMatchReservation(
        caller,
        operation,
        "ORIGINATING_SESSION_INACTIVE_OR_MISMATCHED",
      );
      return {
        ...denied,
        sourceCheckStatus: "DENIED",
        sourceCheckPassed: false,
        permitIssued: false,
        testOnly: true,
      };
    }
    if (pairState.aBlockedB || pairState.bBlockedA) {
      const denied = await this.denyMatchReservation(
        caller,
        operation,
        "PAIR_BLOCKED",
      );
      return {
        ...denied,
        sourceCheckStatus: "DENIED",
        sourceCheckPassed: false,
        permitIssued: false,
        testOnly: true,
      };
    }

    const sourceRevisions = {
      accounts: Object.fromEntries(
        subjects.map((subject) => {
          const account = accounts.get(subject)!;
          return [
            subject,
            {
              status: account.accountStatus,
              revision: account.accountStatusVersion,
              verified: account.isVerified,
            },
          ];
        }),
      ),
      profile: {
        pairRevision: pairState.pairRevision,
        mappingIdentityHash: pairState.mappingIdentityHash,
        readConsistency: pairState.readConsistency,
      },
      eligibility: {
        sourceCheckOnly: !(commitmentTestEnabled || productionMatchEnabled),
        ...(commitmentTestEnabled
          ? { permitPolicy: "C17_DISPOSABLE_MATCH_V1" }
          : productionMatchEnabled
            ? { permitPolicy: "MATCH_V1" }
            : {}),
        emailVerificationPolicy: "OWNER_APPROVED_BOTH_VERIFIED",
        originatingSessionPolicy: "OWNER_APPROVED_EXACT_ACTIVE_AUTH_SESSION",
        sessions: Object.fromEntries(
          participants.map((participant) => {
            const session = sessions.get(participant.originatingSessionId)!;
            return [
              participant.authSubject,
              {
                sessionId: session.id,
                active: session.revokedAt === null && session.expiresAt > now,
                expiresAt: session.expiresAt.toISOString(),
              },
            ];
          }),
        ),
      },
    };
    const checked = await this.prisma.$transaction(async (tx) => {
      const resources = await this.lockResources(tx, operation.resourceKeys);
      const locked = await this.lockOperation(tx, input.operationId);
      if (
        resources.length !== operation.resourceKeys.length ||
        resources.some(
          (resource) => resource.owner_operation_id !== input.operationId,
        )
      ) {
        throw new ConflictException(
          "MATCH no longer owns its complete resource fence",
        );
      }
      const expectedEpochs = this.jsonRecord(operation.fenceEpochs);
      if (
        resources.some(
          (resource) =>
            expectedEpochs[resource.resource_key] !==
            resource.fence_epoch.toString(),
        )
      ) {
        throw new ConflictException("MATCH resource fencing epoch is stale");
      }
      if (locked.state === "CHECKED") {
        return this.getOperation(input.operationId, caller);
      }
      if (locked.state !== "HELD" && locked.state !== "RECOVERY_REQUIRED") {
        throw new ConflictException(
          "MATCH is no longer held for an authoritative source check",
        );
      }
      await tx.safetyOperation.update({
        where: { id: input.operationId },
        data: {
          state: "CHECKED",
          sourceRevisions: this.jsonValue(sourceRevisions),
          recoveryMetadata: null,
        },
      });
      return this.getOperation(input.operationId, caller);
    }, TRANSACTION_OPTIONS);
    await b2c9TestFaultPoint(
      "auth.match.checked.before-response",
      input.operationId,
    );
    return this.matchSourceCheckResult(
      checked,
      checked.state === "CHECKED",
      commitmentTestEnabled || productionMatchEnabled,
    );
  }

  async reserveDisclosure(
    caller: SafetyCaller,
    input: DisclosureReservationDto,
  ) {
    if (
      caller.id !== "chat-backend-service" ||
      caller.scope !== "safety:operations:disclosure:reserve"
    ) {
      throw new ForbiddenException(
        "Chat DISCLOSURE reservation scope is required",
      );
    }
    if (!this.disclosureEnabled()) {
      throw new ServiceUnavailableException(
        "DISCLOSURE authorization is disabled",
      );
    }
    if (!this.profilePairState || !this.chatMatchJournal) {
      throw new ServiceUnavailableException(
        "DISCLOSURE source authorities are unavailable",
      );
    }
    if (!process.env.AUTH_DISCLOSURE_PERMIT_PRIVATE_KEY?.trim()) {
      throw new ServiceUnavailableException(
        "DISCLOSURE permit signing is not configured",
      );
    }

    const roomId = input.roomId.toLowerCase();
    const requesterSubject = input.requesterSubject.toLowerCase();
    const participantSubjects = input.participantSubjects
      .map((subject) => subject.toLowerCase())
      .sort();
    if (
      new Set(participantSubjects).size !== 2 ||
      !participantSubjects.includes(requesterSubject)
    ) {
      throw new UnprocessableEntityException(
        "DISCLOSURE requires the exact requester and pair",
      );
    }
    const metadata = {
      roomId,
      requesterSubject,
      participantSubjects,
      policy: "DISCLOSURE_V1",
    };
    const commandHash = createHash("sha256")
      .update(this.stableJson(metadata))
      .digest("hex");
    const operation = await this.createOperation(
      caller,
      {
        operationId: input.operationId,
        type: "DISCLOSURE",
        subjects: participantSubjects,
        commandHash,
      },
      metadata,
    );

    if (operation.state === "FINALIZED") {
      return {
        operationId: operation.operationId,
        state: operation.state,
        permitIssued: false,
      };
    }
    if (!["HELD", "RECOVERY_REQUIRED", "CHECKED"].includes(operation.state)) {
      return {
        operationId: operation.operationId,
        state: operation.state,
        permitIssued: false,
      };
    }

    // Recover the lost-response case without requiring the room to remain in
    // its pre-disclosure state. Chat's durable receipt is authoritative proof
    // that this exact checked operation already committed.
    if (["CHECKED", "RECOVERY_REQUIRED"].includes(operation.state)) {
      const persistedOperation = await this.requireOperation(
        operation.operationId,
      );
      let evidence: Record<string, unknown>;
      try {
        evidence = await this.chatMatchJournal.verifyDisclosure(
          operation.operationId,
        );
      } catch {
        // Keep the account and pair resources held while Chat's outcome is
        // ambiguous. A retry may resolve it once Chat is reachable.
        await this.markDisclosureSourceUnavailable(operation.operationId);
        throw new ServiceUnavailableException(
          "DISCLOSURE commit state is unavailable; resources remain held",
        );
      }
      const receipt = evidence.receipt;
      const persistedMetadata = operation.requestMetadata as Record<
        string,
        unknown
      > | null;
      if (
        evidence.state === "COMMITTED" &&
        evidence.operationId === operation.operationId &&
        evidence.roomId === metadata.roomId &&
        evidence.requesterSubject === metadata.requesterSubject &&
        receipt &&
        typeof receipt === "object" &&
        !Array.isArray(receipt) &&
        (receipt as Record<string, unknown>).kind ===
          "CHAT_DISCLOSURE_COMMITTED" &&
        (receipt as Record<string, unknown>).payloadHash ===
          persistedOperation.requestHash &&
        this.sameJson(
          (receipt as Record<string, unknown>).resourceKeys,
          persistedOperation.resourceKeys,
        ) &&
        this.sameJson(
          (receipt as Record<string, unknown>).fenceEpochs,
          persistedOperation.fenceEpochs,
        ) &&
        this.sameJson(
          (receipt as Record<string, unknown>).sourceRevisions,
          persistedOperation.sourceRevisions,
        ) &&
        persistedMetadata?.roomId === roomId &&
        persistedMetadata?.requesterSubject === requesterSubject &&
        this.sameJson(
          persistedMetadata?.participantSubjects,
          participantSubjects,
        )
      ) {
        const privateKey =
          process.env.AUTH_DISCLOSURE_PERMIT_PRIVATE_KEY?.replace(/\\n/g, "\n");
        if (!privateKey) {
          await this.markDisclosureSourceUnavailable(operation.operationId);
          throw new ServiceUnavailableException(
            "DISCLOSURE permit signing is unavailable; resources remain held",
          );
        }
        const counterpartSubject = participantSubjects.find(
          (subject) => subject !== requesterSubject,
        )!;
        const sourceRevisions = operation.sourceRevisions;
        const permitClaims = {
          operationId: operation.operationId,
          roomId,
          requesterSubject,
          counterpartSubject,
          participantSubjects,
          resourceKeys: [...persistedOperation.resourceKeys].sort(),
          fenceEpochs: this.jsonRecord(persistedOperation.fenceEpochs),
          sourceRevisions,
          requestHash: persistedOperation.requestHash,
          policy: "DISCLOSURE_V1",
        };
        const disclosureToken = jwt.sign(permitClaims, privateKey, {
          algorithm: "RS256",
          issuer: "chalant-auth-safety-ordering",
          audience: "chat-profile-reveal",
          subject: requesterSubject,
          expiresIn: 30,
        });
        const permitId = createHash("sha256")
          .update(this.stableJson(permitClaims))
          .digest("hex");
        return {
          ...operation,
          state: "CHECKED",
          permitIssued: true,
          disclosurePermit: {
            ...permitClaims,
            permitId,
            token: disclosureToken,
          },
        };
      }
    }

    let accountRows: Array<{
      id: string;
      accountStatus: string;
      accountStatusVersion: number;
      isVerified: boolean;
    }>;
    let pairState;
    let chatState: Record<string, unknown>;
    try {
      [accountRows, pairState, chatState] = await Promise.all([
        this.prisma.user.findMany({
          where: { id: { in: participantSubjects } },
          select: {
            id: true,
            accountStatus: true,
            accountStatusVersion: true,
            isVerified: true,
          },
        }),
        this.profilePairState.readPairState(
          participantSubjects[0],
          participantSubjects[1],
        ),
        this.chatMatchJournal.inspectDisclosure({
          operationId: input.operationId.toLowerCase(),
          roomId,
          requesterSubject,
          participantSubjects,
        }),
      ]);
    } catch {
      await this.markDisclosureSourceUnavailable(input.operationId);
      throw new ServiceUnavailableException(
        "DISCLOSURE source state is unavailable; resources remain held",
      );
    }

    const chatEligible = this.validChatDisclosureState(chatState, {
      operationId: input.operationId.toLowerCase(),
      roomId,
      requesterSubject,
      participantSubjects,
    });
    const accounts = new Map(
      accountRows.map((row) => [row.id.toLowerCase(), row]),
    );
    if (
      accounts.size !== 2 ||
      participantSubjects.some(
        (subject) =>
          accounts.get(subject)?.accountStatus !== "ACTIVE" ||
          accounts.get(subject)?.isVerified !== true,
      ) ||
      pairState.aBlockedB ||
      pairState.bBlockedA ||
      !chatEligible
    ) {
      const failureCode =
        pairState.aBlockedB || pairState.bBlockedA
          ? "PAIR_BLOCKED"
          : !chatEligible
            ? "CHAT_DISCLOSURE_NOT_ELIGIBLE"
            : "ACCOUNT_NOT_ACTIVE_VERIFIED_OR_UNKNOWN";
      const denied = await this.denyDisclosureReservation(
        operation,
        failureCode,
      );
      return { ...denied, permitIssued: false };
    }

    const sourceRevisions = {
      accounts: Object.fromEntries(
        participantSubjects.map((subject) => {
          const account = accounts.get(subject)!;
          return [
            subject,
            {
              status: account.accountStatus,
              revision: account.accountStatusVersion,
              verified: account.isVerified,
            },
          ];
        }),
      ),
      profile: {
        pairRevision: pairState.pairRevision,
        mappingIdentityHash: pairState.mappingIdentityHash,
        readConsistency: pairState.readConsistency,
      },
      chat: {
        roomId,
        matchAt: chatState.matchAt,
        firstMessageAt: chatState.firstMessageAt,
        consentLockedAt: chatState.consentLockedAt,
        revealOutcome: chatState.revealOutcome,
        databaseNow: chatState.databaseNow,
      },
    };

    const checked = await this.prisma.$transaction(async (tx) => {
      const resources = await this.lockResources(tx, operation.resourceKeys);
      const locked = await this.lockOperation(tx, input.operationId);
      const epochs = this.jsonRecord(operation.fenceEpochs);
      if (
        !["HELD", "RECOVERY_REQUIRED", "CHECKED"].includes(locked.state) ||
        resources.length !== operation.resourceKeys.length ||
        resources.some(
          (resource) =>
            resource.owner_operation_id !== input.operationId ||
            epochs[resource.resource_key] !== resource.fence_epoch.toString(),
        )
      ) {
        throw new ConflictException(
          "DISCLOSURE no longer owns its account and pair fences",
        );
      }
      await tx.safetyOperation.update({
        where: { id: input.operationId },
        data: {
          state: "CHECKED",
          sourceRevisions: this.jsonValue(sourceRevisions),
          recoveryMetadata: null,
        },
      });
      return this.getOperation(input.operationId, caller);
    }, TRANSACTION_OPTIONS);

    const privateKey = process.env.AUTH_DISCLOSURE_PERMIT_PRIVATE_KEY?.replace(
      /\\n/g,
      "\n",
    );
    if (!privateKey) {
      await this.markDisclosureSourceUnavailable(input.operationId);
      throw new ServiceUnavailableException(
        "DISCLOSURE permit signing is unavailable; resources remain held",
      );
    }
    const counterpartSubject = participantSubjects.find(
      (subject) => subject !== requesterSubject,
    )!;
    const persistedOperation = await this.requireOperation(input.operationId);
    const permitClaims = {
      operationId: operation.operationId,
      roomId,
      requesterSubject,
      counterpartSubject,
      participantSubjects,
      resourceKeys: [...operation.resourceKeys].sort(),
      fenceEpochs: this.jsonRecord(operation.fenceEpochs),
      sourceRevisions,
      requestHash: persistedOperation.requestHash,
      policy: "DISCLOSURE_V1",
    };
    const disclosureToken = jwt.sign(permitClaims, privateKey, {
      algorithm: "RS256",
      issuer: "chalant-auth-safety-ordering",
      audience: "chat-profile-reveal",
      subject: requesterSubject,
      expiresIn: 30,
    });
    const permitId = createHash("sha256")
      .update(this.stableJson(permitClaims))
      .digest("hex");
    return {
      ...checked,
      state: "CHECKED",
      permitIssued: true,
      disclosurePermit: { ...permitClaims, permitId, token: disclosureToken },
    };
  }

  async finalizeDisclosure(caller: SafetyCaller, operationId: string) {
    if (
      caller.id !== "chat-backend-service" ||
      caller.scope !== "safety:operations:disclosure:finalize"
    ) {
      throw new ForbiddenException(
        "Chat DISCLOSURE finalization scope is required",
      );
    }
    if (!this.disclosureEnabled()) {
      throw new ServiceUnavailableException(
        "DISCLOSURE finalization is disabled",
      );
    }
    const operation = await this.requireOperation(operationId);
    if (
      operation.operationType !== "DISCLOSURE" ||
      operation.callerServiceId !== caller.id
    ) {
      throw new ForbiddenException("DISCLOSURE operation ownership mismatch");
    }
    if (!this.chatMatchJournal)
      throw new ServiceUnavailableException(
        "Chat receipt verifier is unavailable",
      );
    const evidence = await this.chatMatchJournal.verifyDisclosure(operationId);
    const metadata = operation.requestMetadata as Record<
      string,
      unknown
    > | null;
    const receipt = evidence.receipt;
    if (
      evidence.state !== "COMMITTED" ||
      evidence.operationId !== operationId ||
      evidence.roomId !== metadata?.roomId ||
      evidence.requesterSubject !== metadata?.requesterSubject ||
      !receipt ||
      typeof receipt !== "object" ||
      Array.isArray(receipt) ||
      (receipt as Record<string, unknown>).kind !==
        "CHAT_DISCLOSURE_COMMITTED" ||
      (receipt as Record<string, unknown>).operationId !== operationId ||
      (receipt as Record<string, unknown>).payloadHash !==
        operation.requestHash ||
      !this.sameJson(
        (receipt as Record<string, unknown>).resourceKeys,
        operation.resourceKeys,
      ) ||
      !this.sameJson(
        (receipt as Record<string, unknown>).fenceEpochs,
        operation.fenceEpochs,
      ) ||
      !this.sameJson(
        (receipt as Record<string, unknown>).sourceRevisions,
        operation.sourceRevisions,
      ) ||
      typeof (receipt as Record<string, unknown>).transactionId !== "string"
    ) {
      throw new ConflictException(
        "Chat DISCLOSURE receipt is forged or mismatched",
      );
    }

    const releasedKeys = await this.prisma.$transaction(async (tx) => {
      const resources = await this.lockResources(tx, operation.resourceKeys);
      const locked = await this.lockOperation(tx, operationId);
      if (locked.state === "FINALIZED") {
        if (!this.sameJson(locked.chatReceipt, receipt))
          throw new ConflictException(
            "Conflicting finalized DISCLOSURE receipt",
          );
        return [];
      }
      const epochs = this.jsonRecord(operation.fenceEpochs);
      if (
        locked.state !== "CHECKED" &&
        locked.state !== "RECOVERY_REQUIRED" &&
        locked.state !== "CHAT_COMMITTED"
      )
        throw new ConflictException("DISCLOSURE is not held for finalization");
      if (
        resources.length !== operation.resourceKeys.length ||
        resources.some(
          (resource) =>
            resource.owner_operation_id !== operationId ||
            epochs[resource.resource_key] !== resource.fence_epoch.toString(),
        )
      )
        throw new ConflictException("DISCLOSURE resource fence is stale");
      if (locked.state !== "CHAT_COMMITTED") {
        await tx.safetyOperation.update({
          where: { id: operationId },
          data: {
            state: "CHAT_COMMITTED",
            chatReceipt: this.jsonValue(receipt),
          },
        });
      }
      await tx.safetyOperation.update({
        where: { id: operationId },
        data: { state: "FINALIZED" },
      });
      await this.releaseOwnedResources(tx, operationId, operation.resourceKeys);
      return operation.resourceKeys;
    }, TRANSACTION_OPTIONS);
    await this.advanceWaiters(releasedKeys);
    return this.getOperation(operationId, caller);
  }

  private async createOperation(
    caller: SafetyCaller,
    input: CreateSafetyOperationDto,
    requestMetadata?: Record<string, unknown>,
  ) {
    const type = input.type as SafetyOperationType;

    const subjects = this.canonicalSubjects(type, input.subjects);
    const resourceKeys = this.resourceKeys(type, subjects);
    const requestHash = this.requestHash(
      caller.id,
      type,
      subjects,
      resourceKeys,
      input.commandHash,
    );
    if (type === "ACCOUNT_MUTATION" && !input.commandHash) {
      throw new UnprocessableEntityException(
        "Account mutations require a command hash",
      );
    }

    const existing = await this.prisma.safetyOperation.findUnique({
      where: { id: input.operationId },
    });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException(
          "Operation ID was reused with different arguments",
        );
      }
      if (existing.callerServiceId !== caller.id) {
        throw new ConflictException("Operation ID belongs to another service");
      }
      if (existing.state === "REQUESTED")
        await this.tryGrant(input.operationId);
      return this.getOperation(input.operationId, caller);
    }

    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.safetyOperation.create({
            data: {
              id: input.operationId,
              requestHash,
              operationType: type,
              callerServiceId: caller.id,
              subjects,
              resourceKeys,
              ...(requestMetadata
                ? { requestMetadata: this.jsonValue(requestMetadata) }
                : {}),
              state: "REQUESTED",
            },
          });

          // Ticket allocation locks the same resource rows as grant checks.
          // All code paths take those locks in lexical order.
          const waiterTickets: Record<string, string> = {};
          for (const resourceKey of resourceKeys) {
            const ticketRows = await tx.$queryRaw<
              Array<{ next_ticket: bigint }>
            >(Prisma.sql`
              INSERT INTO safety_resources (resource_key, next_ticket, fence_epoch, updated_at)
              VALUES (${resourceKey}, 1, 0, CURRENT_TIMESTAMP)
              ON CONFLICT (resource_key) DO UPDATE
                SET next_ticket = safety_resources.next_ticket + 1,
                    updated_at = CURRENT_TIMESTAMP
              RETURNING next_ticket
            `);
            const ticket = ticketRows[0]?.next_ticket;
            if (ticket === undefined) {
              throw new ServiceUnavailableException(
                "Could not allocate a durable resource waiter ticket",
              );
            }
            await tx.safetyOperationWaiter.create({
              data: {
                operationId: input.operationId,
                resourceKey,
                ticket,
              },
            });
            waiterTickets[resourceKey] = ticket.toString();
          }
          await tx.safetyOperation.update({
            where: { id: input.operationId },
            data: { waiterTickets },
          });
        },
        {
          ...TRANSACTION_OPTIONS,
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        },
      );
    } catch (error) {
      if (this.isOperationIdConflict(error)) {
        const raced = await this.prisma.safetyOperation.findUnique({
          where: { id: input.operationId },
        });
        if (
          raced?.requestHash === requestHash &&
          raced.callerServiceId === caller.id
        ) {
          if (raced.state === "REQUESTED")
            await this.tryGrant(input.operationId);
          return this.getOperation(input.operationId, caller);
        }
        throw new ConflictException(
          "Operation ID was reused with different arguments",
        );
      }
      throw error;
    }

    await this.tryGrant(input.operationId);
    const operation = await this.getOperation(input.operationId, caller);
    if (operation.state === "HELD") {
      await b2c9TestFaultPoint(
        "auth.soc.held.before-response",
        input.operationId,
      );
    }
    return operation;
  }

  async getOperation(operationId: string, caller: SafetyCaller) {
    const operation = await this.prisma.safetyOperation.findUnique({
      where: { id: operationId },
    });
    if (!operation) throw new NotFoundException("Safety operation not found");
    if (
      operation.callerServiceId !== caller.id &&
      caller.scope !== "safety:operations:recover"
    ) {
      throw new ForbiddenException("Service cannot inspect this operation");
    }
    const fenceEpochs = this.jsonRecord(operation.fenceEpochs);
    const waiterTickets = this.jsonRecord(operation.waiterTickets);
    return {
      operationId: operation.id,
      type: operation.operationType,
      state: operation.state,
      callerServiceId: operation.callerServiceId,
      subjects: operation.subjects,
      resourceKeys: operation.resourceKeys,
      fenceEpochs,
      waiterTickets,
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt,
      failureCode: operation.failureCode,
      // A held row is an ordering record, not an activated cross-service permit.
      permitIssued: false,
      sourceRevisions: operation.sourceRevisions,
      sourceReceipt: operation.sourceReceipt,
      chatReceipt: operation.chatReceipt,
      requestMetadata: operation.requestMetadata,
    };
  }

  async getOperationForChat(operationId: string, caller: SafetyCaller) {
    if (
      caller.id !== "chat-backend-service" ||
      caller.scope !== "safety:operations:chat:inspect"
    ) {
      throw new ForbiddenException("Chat pair verification scope is required");
    }
    const operation = await this.prisma.safetyOperation.findUnique({
      where: { id: operationId },
    });
    if (!operation) throw new NotFoundException("Safety operation not found");
    if (
      operation.operationType !== "BLOCK" &&
      operation.operationType !== "UNBLOCK"
    ) {
      throw new ForbiddenException("Chat may verify pair operations only");
    }
    if (
      ![
        "HELD",
        "RECOVERY_REQUIRED",
        "CHAT_PAIR_TERMINATED",
        "SOURCE_COMMITTED",
        "FINALIZED",
      ].includes(operation.state)
    ) {
      throw new ConflictException(
        "Pair operation is not held for Chat termination",
      );
    }
    return {
      operationId: operation.id,
      type: operation.operationType,
      state: operation.state,
      callerServiceId: operation.callerServiceId,
      resourceKeys: operation.resourceKeys,
      subjects: operation.subjects,
      fenceEpochs: this.jsonRecord(operation.fenceEpochs),
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt,
      chatReceipt: operation.chatReceipt,
      permitIssued: false as const,
    };
  }

  async getMatchOperationForChat(operationId: string, caller: SafetyCaller) {
    if (
      caller.id !== "chat-backend-service" ||
      caller.scope !== "safety:operations:chat:match:inspect"
    ) {
      throw new ForbiddenException("Chat MATCH inspection scope is required");
    }
    const operation = await this.prisma.safetyOperation.findUnique({
      where: { id: operationId },
    });
    if (!operation) throw new NotFoundException("Safety operation not found");
    if (operation.operationType !== "MATCH") {
      throw new ForbiddenException("Chat may inspect MATCH operations only");
    }
    if (
      ![
        "REQUESTED",
        "HELD",
        "CHECKED",
        "RECOVERY_REQUIRED",
        "CHAT_ABORTED",
        "CHAT_COMMITTED",
        "FINALIZED",
        "DENIED",
      ].includes(operation.state)
    ) {
      throw new ConflictException("MATCH operation has an unknown state");
    }
    const matchPermit = this.matchPermitForOperation(operation);
    return {
      operationId: operation.id,
      type: operation.operationType,
      state: operation.state,
      callerServiceId: operation.callerServiceId,
      subjects: operation.subjects,
      resourceKeys: operation.resourceKeys,
      fenceEpochs: this.jsonRecord(operation.fenceEpochs),
      waiterTickets: this.jsonRecord(operation.waiterTickets),
      requestMetadata: operation.requestMetadata,
      sourceRevisions: operation.sourceRevisions,
      failureCode: operation.failureCode,
      chatReceipt: operation.chatReceipt,
      permitIssued: matchPermit !== null,
      matchPermit,
      ...(matchPermit
        ? { testOnly: true }
        : {
            activationBlockedBy: [
              "CHAT_ATOMIC_MATCH_COMMITMENT_NOT_ENABLED",
              "PRODUCTION_MATCH_ACTIVATION_DISABLED",
            ],
          }),
    };
  }

  async recordChatPairTermination(
    caller: SafetyCaller,
    receipt: SafetyReceiptDto,
  ) {
    const operation = await this.requireOperation(receipt.operationId);
    this.validateReceiptResources(operation.resourceKeys, receipt.resourceKeys);
    if (
      operation.operationType !== "BLOCK" &&
      operation.operationType !== "UNBLOCK"
    ) {
      throw new UnprocessableEntityException(
        "Chat pair receipts only apply to pair operations",
      );
    }
    if (
      receipt.kind !== "CHAT_PAIR_TERMINATED" ||
      !receipt.transactionId ||
      !receipt.payloadHash
    ) {
      throw new UnprocessableEntityException(
        "A durable Chat termination receipt is required",
      );
    }
    if (
      caller.id !== "chat-backend-service" ||
      caller.scope !== "safety:receipts:chat" ||
      caller.id === operation.callerServiceId
    ) {
      throw new ForbiddenException("Caller cannot attest Chat receipts");
    }

    const resultingState = await this.prisma.$transaction(async (tx) => {
      await this.lockResources(tx, operation.resourceKeys);
      const locked = await this.lockOperation(tx, operation.id);
      if (
        locked.state === "CHAT_PAIR_TERMINATED" ||
        locked.state === "SOURCE_COMMITTED" ||
        locked.state === "FINALIZED"
      ) {
        if (!this.sameJson(locked.chatReceipt, receipt)) {
          throw new ConflictException("Conflicting Chat receipt for operation");
        }
        return locked.state;
      }
      if (locked.state !== "HELD" && locked.state !== "RECOVERY_REQUIRED") {
        throw new ConflictException(
          "Operation is not in a state that accepts a Chat receipt",
        );
      }
      await tx.safetyOperation.update({
        where: { id: operation.id },
        data: {
          state: "CHAT_PAIR_TERMINATED",
          chatReceipt: this.jsonValue(receipt),
        },
      });
      return "CHAT_PAIR_TERMINATED" as const;
    }, TRANSACTION_OPTIONS);
    return {
      operationId: operation.id,
      state: resultingState,
      receiptId: receipt.receiptId,
    };
  }

  async finalize(caller: SafetyCaller, receipt: SafetyReceiptDto) {
    const operation = await this.requireOperation(receipt.operationId);
    if (operation.operationType === "MATCH") {
      throw new ConflictException(
        "MATCH finalization requires an independently verified committed Chat journal receipt",
      );
    }
    this.validateReceiptResources(operation.resourceKeys, receipt.resourceKeys);
    if (caller.id !== operation.callerServiceId) {
      throw new ForbiddenException(
        "Only the operation owner may finalize its source receipt",
      );
    }
    const expectedKind =
      operation.operationType === "ACCOUNT_MUTATION"
        ? "AUTH_SOURCE_COMMITTED"
        : "PROFILE_SOURCE_COMMITTED";
    if (
      receipt.kind !== expectedKind ||
      !receipt.transactionId ||
      !receipt.payloadHash
    ) {
      throw new UnprocessableEntityException(
        "A matching durable source receipt is required",
      );
    }
    if (
      (operation.operationType === "BLOCK" ||
        operation.operationType === "UNBLOCK") &&
      operation.state !== "CHAT_PAIR_TERMINATED" &&
      operation.state !== "SOURCE_COMMITTED" &&
      operation.state !== "FINALIZED"
    ) {
      throw new ConflictException(
        "Pair operation requires a durable Chat termination receipt first",
      );
    }

    const releasedKeys = await this.prisma.$transaction(async (tx) => {
      await this.lockResources(tx, operation.resourceKeys);
      const locked = await this.lockOperation(tx, operation.id);
      if (locked.state === "FINALIZED") {
        if (!this.sameJson(locked.sourceReceipt, receipt)) {
          throw new ConflictException(
            "Conflicting source receipt for finalized operation",
          );
        }
        return [];
      }
      if (
        locked.state !== "HELD" &&
        locked.state !== "CHAT_PAIR_TERMINATED" &&
        locked.state !== "SOURCE_COMMITTED"
      ) {
        throw new ConflictException(
          "Operation is not ready for source finalization",
        );
      }
      if (
        (operation.operationType === "BLOCK" ||
          operation.operationType === "UNBLOCK") &&
        locked.state !== "CHAT_PAIR_TERMINATED" &&
        locked.state !== "SOURCE_COMMITTED"
      ) {
        throw new ConflictException(
          "Pair operation requires a durable Chat termination receipt first",
        );
      }
      if (locked.state !== "SOURCE_COMMITTED") {
        await tx.safetyOperation.update({
          where: { id: operation.id },
          data: {
            state: "SOURCE_COMMITTED",
            sourceReceipt: this.jsonValue(receipt),
          },
        });
      } else if (!this.sameJson(locked.sourceReceipt, receipt)) {
        throw new ConflictException("Conflicting source receipt for operation");
      }
      await tx.safetyOperation.update({
        where: { id: operation.id },
        data: { state: "FINALIZED" },
      });
      await this.releaseOwnedResources(
        tx,
        operation.id,
        operation.resourceKeys,
      );
      return operation.resourceKeys;
    }, TRANSACTION_OPTIONS);
    await this.advanceWaiters(releasedKeys);
    return this.getOperation(operation.id, caller);
  }

  async finalizeMatch(caller: SafetyCaller, operationId: string) {
    if (
      caller.id !== "chat-backend-service" ||
      caller.scope !== "safety:operations:finalize"
    ) {
      throw new ForbiddenException("Chat MATCH finalization scope is required");
    }
    const operation = await this.requireOperation(operationId);
    if (operation.operationType !== "MATCH") {
      throw new UnprocessableEntityException(
        "Only MATCH operations use Chat commitment verification",
      );
    }
    if (!this.chatMatchJournal) {
      throw new ServiceUnavailableException(
        "Chat MATCH journal verifier is unavailable",
      );
    }
    const binding = this.matchBinding(operation);
    const evidence = await this.chatMatchJournal.verifyOperation(operationId);
    this.assertCommittedMatchEvidence(operation, binding, evidence);

    const releasedKeys = await this.prisma.$transaction(async (tx) => {
      const resources = await this.lockResources(tx, operation.resourceKeys);
      const locked = await this.lockOperation(tx, operationId);
      if (locked.state === "FINALIZED") {
        if (!this.sameJson(locked.chatReceipt, evidence.receipt)) {
          throw new ConflictException(
            "Finalized MATCH has different Chat evidence",
          );
        }
        return [];
      }
      if (locked.state !== "CHECKED" && locked.state !== "RECOVERY_REQUIRED") {
        throw new ConflictException(
          "MATCH is not source-checked and held for commitment",
        );
      }
      this.assertOwnedMatchResources(operation, resources);
      await tx.safetyOperation.update({
        where: { id: operationId },
        data: {
          state: "CHAT_COMMITTED",
          chatReceipt: this.jsonValue(evidence.receipt),
        },
      });
      await tx.safetyOperation.update({
        where: { id: operationId },
        data: { state: "FINALIZED" },
      });
      await this.releaseOwnedResources(tx, operationId, operation.resourceKeys);
      return operation.resourceKeys;
    }, TRANSACTION_OPTIONS);
    await this.advanceWaiters(releasedKeys);
    return this.getOperation(operationId, caller);
  }

  async abortMatch(caller: SafetyCaller, operationId: string) {
    if (
      caller.id !== "chat-backend-service" ||
      caller.scope !== "safety:operations:abort"
    ) {
      throw new ForbiddenException("Chat MATCH abort scope is required");
    }
    const operation = await this.requireOperation(operationId);
    if (operation.operationType !== "MATCH") {
      throw new UnprocessableEntityException(
        "Only MATCH operations use Chat tombstones",
      );
    }
    if (operation.state === "FINALIZED") {
      if (
        operation.chatReceipt &&
        this.sameJson((operation.chatReceipt as any).state, "ABORTED")
      ) {
        return this.getOperation(operationId, caller);
      }
      throw new ConflictException("A finalized MATCH cannot be aborted");
    }
    if (!this.chatMatchJournal) {
      throw new ServiceUnavailableException(
        "Chat MATCH journal writer is unavailable",
      );
    }
    const binding = this.matchBinding(operation);
    const tombstone = await this.chatMatchJournal.writeAbortTombstone(binding);
    this.assertAbortedMatchEvidence(operation, binding, tombstone);

    const releasedKeys = await this.prisma.$transaction(async (tx) => {
      const resources = await this.lockResources(tx, operation.resourceKeys);
      const locked = await this.lockOperation(tx, operationId);
      if (locked.state === "FINALIZED") {
        if (!this.sameJson(locked.chatReceipt, tombstone)) {
          throw new ConflictException(
            "Finalized MATCH has different abort evidence",
          );
        }
        return [];
      }
      if (
        !["REQUESTED", "HELD", "CHECKED", "RECOVERY_REQUIRED"].includes(
          locked.state,
        )
      ) {
        throw new ConflictException(
          "MATCH cannot be aborted after a committed outcome",
        );
      }
      await tx.safetyOperationWaiter.deleteMany({ where: { operationId } });
      const ownsResources = resources.filter(
        (resource) => resource.owner_operation_id === operationId,
      );
      if (
        ownsResources.length !== 0 &&
        ownsResources.length !== operation.resourceKeys.length
      ) {
        throw new ConflictException(
          "MATCH owns only part of its resource fence",
        );
      }
      await tx.safetyOperation.update({
        where: { id: operationId },
        data: {
          state: "CHAT_ABORTED",
          chatReceipt: this.jsonValue(tombstone),
        },
      });
      await tx.safetyOperation.update({
        where: { id: operationId },
        data: { state: "FINALIZED" },
      });
      if (ownsResources.length) {
        await this.releaseOwnedResources(
          tx,
          operationId,
          operation.resourceKeys,
        );
        return operation.resourceKeys;
      }
      return [];
    }, TRANSACTION_OPTIONS);
    await b2c9TestFaultPoint(
      "auth.match.abort.finalized.before-response",
      operationId,
    );
    await this.advanceWaiters(releasedKeys);
    return this.getOperation(operationId, caller);
  }

  async deny(
    caller: SafetyCaller,
    receipt: SafetyReceiptDto,
    failureCode: string,
  ) {
    const operation = await this.requireOperation(receipt.operationId);
    if (operation.operationType === "MATCH") {
      throw new ConflictException(
        "MATCH denial must come from an authoritative source check or Chat journal evidence",
      );
    }
    this.validateReceiptResources(operation.resourceKeys, receipt.resourceKeys);
    if (
      caller.id !== operation.callerServiceId ||
      receipt.kind !== "NO_PROTECTED_EFFECT"
    ) {
      throw new ForbiddenException(
        "A source-owner no-effect receipt is required",
      );
    }
    if (!/^[A-Z][A-Z0-9_]{1,95}$/.test(failureCode)) {
      throw new UnprocessableEntityException("Invalid denial code");
    }
    const releasedKeys = await this.prisma.$transaction(async (tx) => {
      await this.lockResources(tx, operation.resourceKeys);
      const locked = await this.lockOperation(tx, operation.id);
      if (locked.state === "FINALIZED") {
        if (
          locked.failureCode === failureCode &&
          this.sameJson(locked.sourceReceipt, receipt)
        )
          return [];
        throw new ConflictException(
          "Finalized operation has a different outcome",
        );
      }
      if (
        locked.state !== "REQUESTED" &&
        locked.state !== "HELD" &&
        locked.state !== "RECOVERY_REQUIRED"
      ) {
        throw new ConflictException(
          "Operation cannot be denied after a side-effect phase",
        );
      }
      if (
        (operation.operationType === "BLOCK" ||
          operation.operationType === "UNBLOCK") &&
        locked.state !== "REQUESTED"
      ) {
        throw new ConflictException(
          "Pair operation cannot be released after its ordering gate is held without Chat no-effect proof",
        );
      }
      await tx.safetyOperationWaiter.deleteMany({
        where: { operationId: operation.id },
      });
      await tx.safetyOperation.update({
        where: { id: operation.id },
        data: {
          state: "DENIED",
          failureCode,
          sourceReceipt: this.jsonValue(receipt),
        },
      });
      await tx.safetyOperation.update({
        where: { id: operation.id },
        data: { state: "FINALIZED" },
      });
      if (locked.state === "HELD" || locked.state === "RECOVERY_REQUIRED") {
        await this.releaseOwnedResources(
          tx,
          operation.id,
          operation.resourceKeys,
        );
      }
      return operation.resourceKeys;
    }, TRANSACTION_OPTIONS);
    await this.advanceWaiters(releasedKeys);
    return this.getOperation(operation.id, caller);
  }

  async abort(caller: SafetyCaller, receipt: SafetyReceiptDto) {
    const operation = await this.requireOperation(receipt.operationId);
    if (operation.operationType === "MATCH") {
      throw new ConflictException(
        "MATCH abort requires a durable Chat no-effect tombstone",
      );
    }
    this.validateReceiptResources(operation.resourceKeys, receipt.resourceKeys);
    if (
      caller.id !== operation.callerServiceId ||
      receipt.kind !== "NO_PROTECTED_EFFECT"
    ) {
      throw new ForbiddenException(
        "A source-owner durable no-effect receipt is required",
      );
    }
    const releasedKeys = await this.prisma.$transaction(async (tx) => {
      await this.lockResources(tx, operation.resourceKeys);
      const locked = await this.lockOperation(tx, operation.id);
      if (locked.state === "FINALIZED") {
        if (
          locked.state === "FINALIZED" &&
          this.sameJson(locked.sourceReceipt, receipt)
        )
          return [];
        throw new ConflictException("Finalized operation cannot be aborted");
      }
      const abortableStates =
        operation.operationType === "DISCLOSURE"
          ? ["REQUESTED", "HELD", "CHECKED", "RECOVERY_REQUIRED"]
          : ["REQUESTED", "HELD", "RECOVERY_REQUIRED"];
      if (!abortableStates.includes(locked.state)) {
        throw new ConflictException(
          "Operation cannot be aborted after a protected effect",
        );
      }
      if (
        (operation.operationType === "BLOCK" ||
          operation.operationType === "UNBLOCK") &&
        locked.state !== "REQUESTED"
      ) {
        throw new ConflictException(
          "Held pair operations remain gated until Chat provides a terminal receipt",
        );
      }
      await tx.safetyOperationWaiter.deleteMany({
        where: { operationId: operation.id },
      });
      const abortState: SafetyOperationState =
        operation.operationType === "MATCH" ||
        operation.operationType === "DISCLOSURE"
          ? "CHAT_ABORTED"
          : "DENIED";
      if (locked.state !== abortState) {
        await tx.safetyOperation.update({
          where: { id: operation.id },
          data: {
            state: abortState,
            sourceReceipt: this.jsonValue(receipt),
            ...(abortState === "DENIED"
              ? { failureCode: "ABORTED_NO_EFFECT" }
              : {}),
          },
        });
      }
      await tx.safetyOperation.update({
        where: { id: operation.id },
        data: { state: "FINALIZED" },
      });
      if (locked.state === "HELD" || locked.state === "RECOVERY_REQUIRED") {
        await this.releaseOwnedResources(
          tx,
          operation.id,
          operation.resourceKeys,
        );
      }
      return operation.resourceKeys;
    }, TRANSACTION_OPTIONS);
    await this.advanceWaiters(releasedKeys);
    return this.getOperation(operation.id, caller);
  }

  async recoveryQueue(caller: SafetyCaller, limit = 25) {
    if (caller.scope !== "safety:operations:recover") {
      throw new ForbiddenException("Caller cannot inspect recovery operations");
    }
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const rows = await this.prisma.safetyOperation.findMany({
      where: { state: { in: ACTIVE_STATES } },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: boundedLimit,
      select: {
        id: true,
        operationType: true,
        callerServiceId: true,
        resourceKeys: true,
        state: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows.map((row) => ({
      operationId: row.id,
      type: row.operationType,
      callerServiceId: row.callerServiceId,
      resourceKeys: row.resourceKeys,
      state: row.state,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      claimed: false,
    }));
  }

  async markRecoveryRequired(
    caller: SafetyCaller,
    operationId: string,
    reasonCode: string,
  ) {
    if (
      caller.scope !== "safety:operations:recover" ||
      !/^[A-Z][A-Z0-9_]{1,95}$/.test(reasonCode)
    ) {
      throw new ForbiddenException(
        "Recovery scope and a bounded reason code are required",
      );
    }
    const operation = await this.requireOperation(operationId);
    await this.prisma.$transaction(async (tx) => {
      await this.lockResources(tx, operation.resourceKeys);
      const locked = await this.lockOperation(tx, operationId);
      if (locked.state === "FINALIZED") return;
      if (locked.state !== "RECOVERY_REQUIRED") {
        await tx.safetyOperation.update({
          where: { id: operationId },
          data: {
            state: "RECOVERY_REQUIRED",
            recoveryMetadata: {
              reasonCode,
              observedAt: new Date().toISOString(),
            },
          },
        });
      }
    }, TRANSACTION_OPTIONS);
    return this.getOperation(operationId, caller);
  }

  private async tryGrant(operationId: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const operation = await tx.safetyOperation.findUnique({
          where: { id: operationId },
        });
        if (!operation || operation.state !== "REQUESTED") return;
        const resources = await this.lockResources(tx, operation.resourceKeys);
        const locked = await this.lockOperation(tx, operationId);
        if (locked.state !== "REQUESTED") return;
        const waiters = await tx.$queryRaw<WaiterSnapshot[]>(Prisma.sql`
        SELECT operation_id, resource_key, ticket
        FROM safety_operation_waiters
        WHERE resource_key IN (${Prisma.join(operation.resourceKeys)})
        ORDER BY resource_key ASC, ticket ASC
      `);
        const heads = new Map<string, string>();
        for (const waiter of waiters) {
          if (!heads.has(waiter.resource_key))
            heads.set(waiter.resource_key, waiter.operation_id);
        }
        const canGrant =
          resources.length === operation.resourceKeys.length &&
          resources.every(
            (resource) =>
              resource.owner_operation_id === null &&
              heads.get(resource.resource_key) === operationId,
          );
        if (!canGrant) return;

        const fenceEpochs: Record<string, string> = Object.fromEntries(
          resources.map((resource) => [
            resource.resource_key,
            (resource.fence_epoch + 1n).toString(),
          ]),
        );
        await tx.safetyOperationWaiter.deleteMany({ where: { operationId } });
        await tx.safetyOperation.update({
          where: { id: operationId },
          data: { state: "HELD", fenceEpochs },
        });
        for (const resourceKey of operation.resourceKeys) {
          await tx.safetyResource.update({
            where: { resourceKey },
            data: {
              ownerOperationId: operationId,
              fenceEpoch: { increment: 1 },
            },
          });
        }
      },
      {
        ...TRANSACTION_OPTIONS,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }

  private async advanceWaiters(resourceKeys: string[]): Promise<void> {
    for (const resourceKey of [...new Set(resourceKeys)].sort()) {
      const head = await this.prisma.safetyOperationWaiter.findFirst({
        where: { resourceKey },
        orderBy: { ticket: "asc" },
        select: { operationId: true },
      });
      if (head) await this.tryGrant(head.operationId);
    }
  }

  private async lockResources(
    tx: Prisma.TransactionClient,
    resourceKeys: string[],
  ): Promise<ResourceSnapshot[]> {
    const ordered = [...resourceKeys].sort();
    if (ordered.length === 0)
      throw new ConflictException("Operation has no resources");
    const rows = await tx.$queryRaw<ResourceSnapshot[]>(Prisma.sql`
      SELECT resource_key, owner_operation_id, fence_epoch
      FROM safety_resources
      WHERE resource_key IN (${Prisma.join(ordered)})
      ORDER BY resource_key ASC
      FOR UPDATE
    `);
    return rows;
  }

  private async lockOperation(
    tx: Prisma.TransactionClient,
    operationId: string,
  ) {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        state: SafetyOperationState;
        sourceReceipt: Prisma.JsonValue | null;
        chatReceipt: Prisma.JsonValue | null;
        failureCode: string | null;
      }>
    >(Prisma.sql`
      SELECT id, state, source_receipt AS "sourceReceipt", chat_receipt AS "chatReceipt", failure_code AS "failureCode"
      FROM safety_operations WHERE id = ${operationId}::uuid FOR UPDATE
    `);
    if (!rows[0]) throw new NotFoundException("Safety operation not found");
    return rows[0];
  }

  private async releaseOwnedResources(
    tx: Prisma.TransactionClient,
    operationId: string,
    resourceKeys: string[],
  ) {
    const result = await tx.safetyResource.updateMany({
      where: {
        resourceKey: { in: resourceKeys },
        ownerOperationId: operationId,
      },
      data: { ownerOperationId: null },
    });
    if (result.count !== resourceKeys.length) {
      throw new ConflictException("Cannot release an incomplete resource set");
    }
  }

  private async requireOperation(operationId: string) {
    const operation = await this.prisma.safetyOperation.findUnique({
      where: { id: operationId },
    });
    if (!operation) throw new NotFoundException("Safety operation not found");
    return operation;
  }

  private async denyMatchReservation(
    caller: SafetyCaller,
    operation: Awaited<ReturnType<SafetyOrderingService["getOperation"]>>,
    failureCode: string,
  ) {
    const receipt = {
      receiptId: `match-denial:${operation.operationId}`,
      operationId: operation.operationId,
      resourceKeys: operation.resourceKeys,
      kind: "NO_PROTECTED_EFFECT",
      committedAt: new Date().toISOString(),
      payloadHash: createHash("sha256")
        .update(`${operation.operationId}:${failureCode}`)
        .digest("hex"),
    };
    const releasedKeys = await this.prisma.$transaction(async (tx) => {
      await this.lockResources(tx, operation.resourceKeys);
      const locked = await this.lockOperation(tx, operation.operationId);
      if (locked.state === "FINALIZED") {
        if (locked.failureCode === failureCode) return [];
        throw new ConflictException(
          "MATCH operation already has another outcome",
        );
      }
      if (locked.state !== "HELD" && locked.state !== "RECOVERY_REQUIRED") {
        throw new ConflictException("MATCH source denial is no longer current");
      }
      await tx.safetyOperation.update({
        where: { id: operation.operationId },
        data: {
          state: "DENIED",
          failureCode,
          sourceReceipt: this.jsonValue(receipt),
        },
      });
      await tx.safetyOperation.update({
        where: { id: operation.operationId },
        data: { state: "FINALIZED" },
      });
      await this.releaseOwnedResources(
        tx,
        operation.operationId,
        operation.resourceKeys,
      );
      return operation.resourceKeys;
    }, TRANSACTION_OPTIONS);
    await this.advanceWaiters(releasedKeys);
    return this.getOperation(operation.operationId, caller);
  }

  private async markMatchSourceUnavailable(operationId: string): Promise<void> {
    const operation = await this.requireOperation(operationId);
    await this.prisma.$transaction(async (tx) => {
      await this.lockResources(tx, operation.resourceKeys);
      const locked = await this.lockOperation(tx, operationId);
      if (locked.state === "FINALIZED") return;
      if (locked.state !== "HELD" && locked.state !== "RECOVERY_REQUIRED")
        return;
      await tx.safetyOperation.update({
        where: { id: operationId },
        data: {
          state: "RECOVERY_REQUIRED",
          recoveryMetadata: {
            reasonCode: "MATCH_SOURCE_UNAVAILABLE",
            observedAt: new Date().toISOString(),
          },
        },
      });
    }, TRANSACTION_OPTIONS);
  }

  private validChatDisclosureState(
    state: Record<string, unknown>,
    binding: {
      operationId: string;
      roomId: string;
      requesterSubject: string;
      participantSubjects: string[];
    },
  ): boolean {
    if (
      state.operationId !== binding.operationId ||
      state.roomId !== binding.roomId ||
      state.requesterSubject !== binding.requesterSubject ||
      state.state !== "ELIGIBLE" ||
      state.source !== "POSTGRESQL" ||
      !["READY", "DISPATCHED"].includes(String(state.revealOutcome)) ||
      state.consentLockedAt == null ||
      state.decisionA !== true ||
      state.decisionB !== true ||
      state.safetyRestricted !== false ||
      state.noMessageTermination !== false
    )
      return false;
    const matchAt = Date.parse(String(state.matchAt));
    const firstMessageAt = Date.parse(String(state.firstMessageAt));
    const databaseNow = Date.parse(String(state.databaseNow));
    const eligibleAt = Date.parse(String(state.eligibleAt));
    const expectedRoomState =
      state.roomStatus === "ACTIVE" ||
      (state.roomStatus === "EXPIRED" &&
        state.endReason === "ROOM_EXPIRY_48H") ||
      (state.roomStatus === "REVEALED" && state.endReason === "MUTUAL_REVEAL");
    return (
      expectedRoomState &&
      Number.isFinite(matchAt) &&
      Number.isFinite(firstMessageAt) &&
      Number.isFinite(databaseNow) &&
      Number.isFinite(eligibleAt) &&
      firstMessageAt < matchAt + 36 * 60 * 60 * 1000 &&
      eligibleAt === firstMessageAt + 30 * 60 * 1000 &&
      databaseNow >= eligibleAt &&
      databaseNow < matchAt + 72 * 60 * 60 * 1000
    );
  }

  private async denyDisclosureReservation(
    operation: Awaited<ReturnType<SafetyOrderingService["getOperation"]>>,
    failureCode: string,
  ) {
    const receipt = {
      receiptId: `disclosure-denial:${operation.operationId}`,
      operationId: operation.operationId,
      resourceKeys: operation.resourceKeys,
      kind: "NO_PROTECTED_EFFECT",
      committedAt: new Date().toISOString(),
      payloadHash: createHash("sha256")
        .update(`${operation.operationId}:${failureCode}`)
        .digest("hex"),
    };
    const releasedKeys = await this.prisma.$transaction(async (tx) => {
      await this.lockResources(tx, operation.resourceKeys);
      const locked = await this.lockOperation(tx, operation.operationId);
      if (locked.state === "FINALIZED") {
        if (locked.failureCode === failureCode) return [];
        throw new ConflictException(
          "DISCLOSURE operation already has another outcome",
        );
      }
      if (!["HELD", "RECOVERY_REQUIRED", "CHECKED"].includes(locked.state)) {
        throw new ConflictException("DISCLOSURE denial is no longer current");
      }
      await tx.safetyOperation.update({
        where: { id: operation.operationId },
        data: {
          state: "DENIED",
          failureCode,
          sourceReceipt: this.jsonValue(receipt),
        },
      });
      await tx.safetyOperation.update({
        where: { id: operation.operationId },
        data: { state: "FINALIZED" },
      });
      await this.releaseOwnedResources(
        tx,
        operation.operationId,
        operation.resourceKeys,
      );
      return operation.resourceKeys;
    }, TRANSACTION_OPTIONS);
    await this.advanceWaiters(releasedKeys);
    return this.getOperation(operation.operationId, {
      id: operation.callerServiceId,
      audience: "auth-safety-ordering",
      scope: "safety:operations:disclosure:reserve",
    });
  }

  private async markDisclosureSourceUnavailable(
    operationId: string,
  ): Promise<void> {
    const operation = await this.requireOperation(operationId);
    await this.prisma.$transaction(async (tx) => {
      await this.lockResources(tx, operation.resourceKeys);
      const locked = await this.lockOperation(tx, operationId);
      if (locked.state === "FINALIZED") return;
      if (!["HELD", "RECOVERY_REQUIRED", "CHECKED"].includes(locked.state))
        return;
      await tx.safetyOperation.update({
        where: { id: operationId },
        data: {
          state: "RECOVERY_REQUIRED",
          recoveryMetadata: {
            reasonCode: "DISCLOSURE_SOURCE_UNAVAILABLE",
            observedAt: new Date().toISOString(),
          },
        },
      });
    }, TRANSACTION_OPTIONS);
  }

  private matchSourceCheckResult(
    operation: any,
    reused: boolean,
    commitmentTestEnabled = this.matchCommitmentTestEnabled() ||
      this.matchProductionEnabled(),
  ) {
    const matchPermit = commitmentTestEnabled
      ? this.matchPermitForOperation(operation)
      : null;
    return {
      ...operation,
      state: "CHECKED",
      sourceCheckStatus: "PASSED",
      sourceCheckPassed: true,
      sourceCheckReused: reused,
      permitIssued: matchPermit !== null,
      matchPermit,
      ...(this.matchCommitmentTestEnabled() ? { testOnly: true } : {}),
      ...(matchPermit
        ? {}
        : {
            activationBlockedBy: [
              "CHAT_ATOMIC_MATCH_COMMITMENT_NOT_ENABLED",
              "PRODUCTION_MATCH_ACTIVATION_DISABLED",
            ],
          }),
    };
  }

  private disclosureEnabled(): boolean {
    const value = process.env.AUTH_DISCLOSURE_ENABLED;
    if (value !== undefined && value !== "true" && value !== "false") {
      throw new ServiceUnavailableException(
        "AUTH_DISCLOSURE_ENABLED must be true or false",
      );
    }
    return value === "true";
  }

  private matchCommitmentTestEnabled(): boolean {
    return (
      process.env.NODE_ENV === "test" &&
      process.env.AUTH_MATCH_COMMITMENT_ENABLED === "true" &&
      process.env.AUTH_MATCH_COMMITMENT_TEST_MODE === "true"
    );
  }

  private matchTestSourceCheckEnabled(): boolean {
    return (
      process.env.NODE_ENV === "test" &&
      process.env.AUTH_MATCH_SOURCE_CHECK_ENABLED === "true" &&
      process.env.AUTH_MATCH_SOURCE_CHECK_TEST_MODE === "true"
    );
  }

  private matchProductionEnabled(): boolean {
    const source = process.env.AUTH_MATCH_SOURCE_CHECK_ENABLED;
    const commitment = process.env.AUTH_MATCH_COMMITMENT_ENABLED;
    const testMode = process.env.AUTH_MATCH_SOURCE_CHECK_TEST_MODE;
    const commitmentTestMode = process.env.AUTH_MATCH_COMMITMENT_TEST_MODE;
    if (
      [source, commitment, testMode, commitmentTestMode].some(
        (value) => value !== undefined && value !== "true" && value !== "false",
      )
    ) {
      throw new ServiceUnavailableException(
        "Auth MATCH flags must be exactly true or false",
      );
    }
    return (
      process.env.NODE_ENV === "production" &&
      source === "true" &&
      commitment === "true" &&
      testMode !== "true" &&
      commitmentTestMode !== "true"
    );
  }

  private matchPermitForOperation(
    operation: any,
  ): Record<string, unknown> | null {
    const operationId = operation.operationId ?? operation.id;
    const metadata = operation.requestMetadata;
    const sourceRevisions = operation.sourceRevisions;
    if (
      !(this.matchCommitmentTestEnabled() || this.matchProductionEnabled()) ||
      (operation.operationType !== "MATCH" && operation.type !== "MATCH") ||
      operation.state !== "CHECKED" ||
      !metadata ||
      typeof metadata !== "object" ||
      Array.isArray(metadata) ||
      !sourceRevisions ||
      typeof sourceRevisions !== "object" ||
      Array.isArray(sourceRevisions) ||
      (sourceRevisions as any).eligibility?.sourceCheckOnly !== false ||
      (this.matchCommitmentTestEnabled()
        ? (sourceRevisions as any).eligibility?.permitPolicy !==
          "C17_DISPOSABLE_MATCH_V1"
        : (sourceRevisions as any).eligibility?.permitPolicy !== "MATCH_V1")
    ) {
      return null;
    }
    const value = metadata as Record<string, unknown>;
    if (
      typeof value.proposalId !== "string" ||
      typeof value.chatOperationId !== "string"
    )
      return null;
    const binding = {
      operationId,
      chatOperationId: value.chatOperationId,
      proposalId: value.proposalId,
      participants: value.participants,
      resourceKeys: [...operation.resourceKeys].sort(),
      fenceEpochs: this.jsonRecord(operation.fenceEpochs),
      sourceRevisions,
    };
    return {
      ...binding,
      permitId: createHash("sha256")
        .update(this.stableJson(binding))
        .digest("hex"),
      ...(this.matchCommitmentTestEnabled()
        ? { testOnly: true }
        : { policy: "MATCH_V1" }),
    };
  }

  private matchBinding(operation: any): ChatMatchOperationBinding {
    const metadata = operation.requestMetadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      throw new ConflictException(
        "MATCH request binding is missing from the durable SOC record",
      );
    }
    const value = metadata as Record<string, unknown>;
    const participants = value.participants;
    if (
      typeof value.chatOperationId !== "string" ||
      typeof value.proposalId !== "string" ||
      !Array.isArray(participants) ||
      participants.length !== 2 ||
      participants.some(
        (participant) =>
          !participant ||
          typeof participant !== "object" ||
          typeof (participant as Record<string, unknown>).authSubject !==
            "string" ||
          typeof (participant as Record<string, unknown>).searchId !==
            "string" ||
          typeof (participant as Record<string, unknown>).generation !==
            "string" ||
          typeof (participant as Record<string, unknown>)
            .originatingSessionId !== "string",
      )
    ) {
      throw new ConflictException("MATCH request binding is malformed");
    }
    const sourceRevisions =
      operation.sourceRevisions &&
      typeof operation.sourceRevisions === "object" &&
      !Array.isArray(operation.sourceRevisions)
        ? (operation.sourceRevisions as Record<string, unknown>)
        : {};
    return {
      operationId: operation.id,
      chatOperationId: value.chatOperationId,
      proposalId: value.proposalId,
      participants: (
        participants as ChatMatchOperationBinding["participants"]
      ).map((participant) => ({
        authSubject: participant.authSubject.toLowerCase(),
        searchId: participant.searchId.toLowerCase(),
        generation: participant.generation,
        originatingSessionId: participant.originatingSessionId.toLowerCase(),
      })),
      resourceKeys: [...operation.resourceKeys].sort(),
      fenceEpochs: this.jsonRecord(operation.fenceEpochs),
      sourceRevisions,
    };
  }

  private assertOwnedMatchResources(
    operation: any,
    resources: ResourceSnapshot[],
  ): void {
    if (
      resources.length !== operation.resourceKeys.length ||
      resources.some((resource) => resource.owner_operation_id !== operation.id)
    ) {
      throw new ConflictException(
        "MATCH does not own its complete resource fence",
      );
    }
    const expectedEpochs = this.jsonRecord(operation.fenceEpochs);
    if (
      resources.some(
        (resource) =>
          expectedEpochs[resource.resource_key] !==
          resource.fence_epoch.toString(),
      )
    ) {
      throw new ConflictException("MATCH resource fencing epoch is stale");
    }
  }

  private assertAbortedMatchEvidence(
    _operation: any,
    binding: ChatMatchOperationBinding,
    evidence: Record<string, unknown>,
  ): void {
    const requestHash = createHash("sha256")
      .update(this.stableJson(binding))
      .digest("hex");
    if (
      evidence.kind !== "CHAT_MATCH_ABORTED" ||
      evidence.operationId !== binding.operationId ||
      evidence.chatOperationId !== binding.chatOperationId ||
      evidence.proposalId !== binding.proposalId ||
      evidence.state !== "ABORTED" ||
      evidence.noProtectedEffect !== true ||
      evidence.requestHash !== requestHash ||
      evidence.payloadHash !== requestHash ||
      typeof evidence.transactionId !== "string" ||
      !this.sameJson(evidence.resourceKeys, binding.resourceKeys) ||
      !this.sameJson(evidence.fenceEpochs, binding.fenceEpochs) ||
      !this.sameJson(evidence.sourceRevisions, binding.sourceRevisions)
    ) {
      throw new ConflictException(
        "Chat MATCH abort evidence does not match the held SOC operation",
      );
    }
  }

  private assertCommittedMatchEvidence(
    _operation: any,
    binding: ChatMatchOperationBinding,
    evidence: Record<string, unknown>,
  ): void {
    const requestHash = createHash("sha256")
      .update(this.stableJson(binding))
      .digest("hex");
    const receipt = evidence.receipt;
    const subjects = binding.participants.map(({ authSubject }) => authSubject);
    const searchIds = binding.participants.map(({ searchId }) => searchId);
    const generations = binding.participants.map(
      ({ generation }) => generation,
    );
    if (
      evidence.state !== "COMMITTED" ||
      evidence.operationId !== binding.operationId ||
      evidence.chatOperationId !== binding.chatOperationId ||
      evidence.proposalId !== binding.proposalId ||
      evidence.requestHash !== requestHash ||
      !this.sameJson(evidence.subjects, subjects) ||
      !this.sameJson(evidence.searchIds, searchIds) ||
      !this.sameJson(evidence.generations, generations) ||
      !this.sameJson(evidence.resourceKeys, binding.resourceKeys) ||
      !this.sameJson(evidence.fenceEpochs, binding.fenceEpochs) ||
      !this.sameJson(evidence.sourceRevisions, binding.sourceRevisions) ||
      !receipt ||
      typeof receipt !== "object" ||
      Array.isArray(receipt) ||
      (receipt as Record<string, unknown>).kind !== "CHAT_MATCH_COMMITTED" ||
      (receipt as Record<string, unknown>).operationId !==
        binding.operationId ||
      (receipt as Record<string, unknown>).payloadHash !== requestHash ||
      typeof evidence.transactionId !== "string"
    ) {
      throw new ConflictException(
        "Chat MATCH commitment evidence is invalid or mismatched",
      );
    }
  }

  private stableJson(value: unknown): string {
    if (Array.isArray(value))
      return `[${value.map((entry) => this.stableJson(entry)).join(",")}]`;
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${this.stableJson(record[key])}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  }

  private canonicalSubjects(
    type: SafetyOperationType,
    input: string[],
  ): string[] {
    const expectedCount = type === "ACCOUNT_MUTATION" ? 1 : 2;
    if (input.length !== expectedCount)
      throw new UnprocessableEntityException(
        "Invalid subject count for operation type",
      );
    const subjects = input.map((subject) => subject.toLowerCase());
    if (new Set(subjects).size !== subjects.length)
      throw new UnprocessableEntityException("Pair subjects must be distinct");
    return type === "ACCOUNT_MUTATION" ? subjects : subjects.sort();
  }

  private resourceKeys(
    type: SafetyOperationType,
    subjects: string[],
  ): string[] {
    if (type === "ACCOUNT_MUTATION") return [`account:${subjects[0]}`];
    if (type === "BLOCK" || type === "UNBLOCK")
      return [`pair:${subjects[0]}:${subjects[1]}`];
    return [
      `account:${subjects[0]}`,
      `account:${subjects[1]}`,
      `pair:${subjects[0]}:${subjects[1]}`,
    ].sort();
  }

  private requestHash(
    callerId: string,
    type: SafetyOperationType,
    subjects: string[],
    resourceKeys: string[],
    commandHash?: string,
  ) {
    return createHash("sha256")
      .update(
        JSON.stringify({ callerId, type, subjects, resourceKeys, commandHash }),
      )
      .digest("hex");
  }

  private resultRevision(result: unknown): unknown {
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const record = result as Record<string, unknown>;
      return record.version ?? record.revision ?? null;
    }
    return null;
  }

  private validateReceiptResources(expected: string[], received: string[]) {
    const canonicalReceived = [...received].sort();
    if (
      JSON.stringify([...expected].sort()) !== JSON.stringify(canonicalReceived)
    ) {
      throw new ConflictException(
        "Receipt resource set does not match operation",
      );
    }
  }

  private jsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private jsonRecord(value: Prisma.JsonValue | null): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) =>
        typeof entry === "string" || typeof entry === "number"
          ? [[key, String(entry)]]
          : [],
      ),
    );
  }

  private sameJson(left: unknown, right: unknown): boolean {
    const stable = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
          .join(",")}}`;
      }
      return JSON.stringify(value);
    };
    return stable(left) === stable(right);
  }

  private isOperationIdConflict(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      return false;
    }
    const target = error.meta?.target;
    if (Array.isArray(target)) return target.includes("id");
    return (
      typeof target === "string" && target.includes("safety_operations_pkey")
    );
  }
}
