import {
  ConflictException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, createHmac, randomBytes } from "crypto";
import { ConfigService } from "../config/config.service";

export interface ChatMatchOperationBinding {
  operationId: string;
  chatOperationId: string;
  proposalId: string;
  participants: Array<{
    authSubject: string;
    searchId: string;
    generation: string;
    originatingSessionId: string;
  }>;
  resourceKeys: string[];
  fenceEpochs: Record<string, string>;
  sourceRevisions: Record<string, unknown>;
}

export interface ChatMatchProposalParticipantBinding {
  authSubject: string;
  searchId: string;
  generation: string;
  originatingSessionId: string;
}

@Injectable()
export class ChatMatchJournalClient {
  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async writeAbortTombstone(
    binding: ChatMatchOperationBinding,
  ): Promise<Record<string, unknown>> {
    const path = "/api/v1/internal/v1/anon-chat/safety/match-operations/abort";
    const result = await this.request(path, binding, "chat:match:abort");
    if (
      result.operationId !== binding.operationId ||
      result.chatOperationId !== binding.chatOperationId ||
      result.proposalId !== binding.proposalId ||
      result.state !== "ABORTED" ||
      result.noProtectedEffect !== true ||
      typeof result.transactionId !== "string" ||
      typeof result.payloadHash !== "string"
    ) {
      throw new ConflictException(
        "Chat returned an invalid MATCH abort tombstone",
      );
    }
    return result;
  }

  async inspectProposal(
    proposalId: string,
  ): Promise<ChatMatchProposalParticipantBinding[]> {
    const path =
      "/api/v1/internal/v1/anon-chat/safety/match-operations/proposal-inspect";
    const result = await this.request(
      path,
      { proposalId },
      "chat:match:proposal:inspect",
    );
    if (
      result.proposalId !== proposalId ||
      result.state !== "PENDING_AUTHORIZATION" ||
      !Array.isArray(result.participants) ||
      result.participants.length !== 2
    ) {
      throw new ConflictException(
        "Chat returned an invalid MATCH proposal binding",
      );
    }
    const participants = result.participants as Array<Record<string, unknown>>;
    if (
      participants.some(
        (participant) =>
          typeof participant.authSubject !== "string" ||
          typeof participant.searchId !== "string" ||
          typeof participant.generation !== "string" ||
          typeof participant.originatingSessionId !== "string",
      )
    ) {
      throw new ConflictException(
        "Chat MATCH proposal is missing its origin-session binding",
      );
    }
    return participants as unknown as ChatMatchProposalParticipantBinding[];
  }

  async verifyOperation(operationId: string): Promise<Record<string, unknown>> {
    const path = "/api/v1/internal/v1/anon-chat/safety/match-operations/verify";
    const result = await this.request(
      path,
      { operationId },
      "chat:match:receipt:verify",
    );
    if (
      result.operationId !== operationId ||
      !["COMMITTED", "ABORTED"].includes(String(result.state))
    ) {
      throw new ConflictException(
        "Chat returned an invalid MATCH journal state",
      );
    }
    return result;
  }

  private async request(
    path: string,
    body: unknown,
    scope: string,
  ): Promise<Record<string, unknown>> {
    const baseUrl = this.config.get("CHAT_MATCH_JOURNAL_URL")?.trim();
    const keyId = this.config.get("CHAT_MATCH_JOURNAL_KEY_ID")?.trim();
    const secret = this.config.get("CHAT_MATCH_JOURNAL_HMAC_SECRET")?.trim();
    if (!baseUrl || !keyId || !secret || secret.length < 32) {
      throw new ServiceUnavailableException(
        "Chat MATCH journal client is not configured",
      );
    }
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(32).toString("base64url");
    const audience = "chat-safety-ordering";
    const bodyDigest = createHash("sha256")
      .update(this.canonicalJson(body))
      .digest("hex");
    const canonical = JSON.stringify([
      2,
      Number(timestamp),
      "auth-safety-ordering",
      "POST",
      path,
      nonce,
      audience,
      scope,
      bodyDigest,
    ]);
    const signature = createHmac("sha256", secret)
      .update(canonical)
      .digest("hex");
    let response: Response;
    try {
      response = await this.fetchImpl(new URL(path, baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chat-safety-service-id": "auth-safety-ordering",
          "x-chat-safety-key-id": keyId,
          "x-chat-safety-timestamp": timestamp,
          "x-chat-safety-nonce": nonce,
          "x-chat-safety-audience": audience,
          "x-chat-safety-scope": scope,
          "x-chat-safety-signature": signature,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        "Chat MATCH journal outcome is unknown; retry the same operation ID",
      );
    }
    if (!response.ok) {
      if (response.status === 409)
        throw new ConflictException(
          "Chat MATCH journal rejected conflicting evidence",
        );
      throw new ServiceUnavailableException(
        `Chat MATCH journal returned HTTP ${response.status}`,
      );
    }
    const value: unknown = await response.json().catch(() => null);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ServiceUnavailableException(
        "Chat MATCH journal response is invalid",
      );
    }
    return value as Record<string, unknown>;
  }

  private canonicalJson(value: unknown): string {
    if (Array.isArray(value))
      return `[${value.map((entry) => this.canonicalJson(entry)).join(",")}]`;
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map(
          (key) => `${JSON.stringify(key)}:${this.canonicalJson(record[key])}`,
        )
        .join(",")}}`;
    }
    return JSON.stringify(value);
  }
}
