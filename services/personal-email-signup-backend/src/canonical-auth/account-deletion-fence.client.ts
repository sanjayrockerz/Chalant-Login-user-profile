import { createHmac, timingSafeEqual } from "node:crypto";
import {
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "../config/config.service";
import type {
  AccountDeletionFenceClient,
  DeletionFenceReceipt,
} from "./account-deletion.service";

interface FenceTarget {
  service: "Profile" | "Chat" | "Realtime";
  baseUrl: string;
  secret: string;
  path: string;
}

export class AuthAccountDeletionFenceClient implements AccountDeletionFenceClient {
  private readonly logger = new Logger(AuthAccountDeletionFenceClient.name);

  constructor(
    private readonly config: ConfigService,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  prepareProfile(
    subject: string,
    operationId: string,
    requestHash: string,
    lifecycleRevision: string,
  ) {
    return this.prepare(
      {
        service: "Profile",
        baseUrl: this.required("PROFILE_ACCOUNT_DELETION_URL"),
        secret: this.required("PROFILE_ACCOUNT_DELETION_HMAC_SECRET"),
        path: "/api/v1/internal/v1/account-deletion/fence",
      },
      subject,
      operationId,
      requestHash,
      lifecycleRevision,
    );
  }

  prepareChat(
    subject: string,
    operationId: string,
    requestHash: string,
    lifecycleRevision: string,
  ) {
    return this.prepare(
      {
        service: "Chat",
        baseUrl: this.required("CHAT_ACCOUNT_DELETION_URL"),
        secret: this.required("CHAT_ACCOUNT_DELETION_HMAC_SECRET"),
        path: "/api/v1/internal/v1/anon-chat/safety/account-deletion/fence",
      },
      subject,
      operationId,
      requestHash,
      lifecycleRevision,
    );
  }

  prepareRealtime(
    subject: string,
    operationId: string,
    requestHash: string,
    lifecycleRevision: string,
  ) {
    return this.prepare(
      {
        service: "Realtime",
        baseUrl: this.required("REALTIME_ACCOUNT_DELETION_URL"),
        secret: this.required("REALTIME_ACCOUNT_DELETION_HMAC_SECRET"),
        path: "/internal/v1/auth/account-deletion/fence",
      },
      subject,
      operationId,
      requestHash,
      lifecycleRevision,
    );
  }

  private async prepare(
    target: FenceTarget,
    subject: string,
    operationId: string,
    requestHash: string,
    lifecycleRevision: string,
  ): Promise<DeletionFenceReceipt> {
    const startedAt = Date.now();
    const body = {
      eventType: "auth.account.deletion.prepare.v1",
      operationId,
      subject,
      requestHash,
      lifecycleRevision,
    };
    const timestamp = Math.floor(this.now() / 1000).toString();
    const signature = createHmac("sha256", target.secret)
      .update(`${timestamp}.${JSON.stringify(body)}`)
      .digest("hex");
    this.logger.log(
      JSON.stringify({
        event: "account_deletion.fence.request_started",
        timestamp: new Date().toISOString(),
        operationId,
        service: target.service,
        path: target.path,
      }),
    );
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${target.baseUrl.replace(/\/+$/, "")}${target.path}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-account-deletion-timestamp": timestamp,
            "x-account-deletion-signature": signature,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(3_000),
        },
      );
    } catch (error) {
      const failure = error as {
        name?: unknown;
        code?: unknown;
        cause?: { code?: unknown; name?: unknown };
      };
      const errorName =
        typeof failure?.name === "string" ? failure.name : "Error";
      const rawCode =
        typeof failure?.cause?.code === "string"
          ? failure.cause.code
          : typeof failure?.code === "string"
            ? failure.code
            : undefined;
      const errorCode =
        rawCode && /^[A-Za-z0-9_]{1,64}$/.test(rawCode)
          ? rawCode
          : "UNCLASSIFIED";
      const timeout =
        errorName === "TimeoutError" ||
        errorName === "AbortError" ||
        ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "ABORT_ERR"].includes(
          errorCode,
        );
      this.logger.warn(
        JSON.stringify({
          event: "account_deletion.fence.transport_failure",
          timestamp: new Date().toISOString(),
          operationId,
          service: target.service,
          path: target.path,
          failureClass: timeout ? "TIMEOUT" : "TRANSPORT",
          errorName,
          errorCode,
          durationMs: Date.now() - startedAt,
        }),
      );
      throw new ServiceUnavailableException(
        "Account deletion fence outcome is unknown; retry the same operation ID",
      );
    }
    this.logger.log(
      JSON.stringify({
        event: "account_deletion.fence.http_response",
        timestamp: new Date().toISOString(),
        operationId,
        service: target.service,
        path: target.path,
        status: response.status,
        durationMs: Date.now() - startedAt,
      }),
    );
    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedException(
        `Deletion fence rejected Auth credentials at ${target.service}`,
      );
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Required deletion fence returned HTTP ${response.status}`,
      );
    }
    let receipt: DeletionFenceReceipt;
    try {
      receipt = (await response.json()) as DeletionFenceReceipt;
    } catch {
      this.logger.warn(
        JSON.stringify({
          event: "account_deletion.fence.receipt_invalid",
          operationId,
          service: target.service,
          reason: "INVALID_JSON",
        }),
      );
      throw new UnauthorizedException("Deletion fence receipt is invalid");
    }
    const receiptFields = {
      operationId: receipt?.operationId === operationId,
      subject:
        typeof receipt?.subject === "string" &&
        receipt.subject.toLowerCase() === subject.toLowerCase(),
      requestHash: receipt?.requestHash === requestHash,
      lifecycleRevision: receipt?.lifecycleRevision === lifecycleRevision,
      state: receipt?.state === "FENCED",
      receiptHash:
        typeof receipt?.receiptHash === "string" &&
        /^[a-f0-9]{64}$/i.test(receipt.receiptHash),
    };
    const expectedReceipt = createHmac("sha256", target.secret)
      .update(
        `receipt.${operationId}.${subject}.${lifecycleRevision}.${requestHash}.FENCED`,
      )
      .digest();
    let actualReceipt: Buffer;
    try {
      actualReceipt = Buffer.from(receipt?.receiptHash || "", "hex");
    } catch {
      this.logger.warn(
        JSON.stringify({
          event: "account_deletion.fence.receipt_invalid",
          operationId,
          service: target.service,
          reason: "INVALID_RECEIPT_HASH",
        }),
      );
      throw new UnauthorizedException("Deletion fence receipt is invalid");
    }
    if (
      !receiptFields.operationId ||
      !receiptFields.subject ||
      !receiptFields.requestHash ||
      !receiptFields.lifecycleRevision ||
      !receiptFields.state ||
      !receiptFields.receiptHash ||
      actualReceipt.length !== expectedReceipt.length ||
      !timingSafeEqual(actualReceipt, expectedReceipt)
    ) {
      this.logger.warn(
        JSON.stringify({
          event: "account_deletion.fence.receipt_invalid",
          operationId,
          service: target.service,
          reason: "BINDING_OR_SIGNATURE_MISMATCH",
          receiptFields,
          signatureValid:
            actualReceipt.length === expectedReceipt.length &&
            timingSafeEqual(actualReceipt, expectedReceipt),
        }),
      );
      throw new UnauthorizedException("Deletion fence receipt is invalid");
    }
    return receipt;
  }

  private required(name: string): string {
    const raw: unknown = (this.config.get as (key: string) => unknown)(name);
    const value = typeof raw === "string" ? raw.trim() : undefined;
    if (!value || (name.endsWith("_SECRET") && value.length < 32)) {
      throw new ServiceUnavailableException(
        `Required account deletion configuration ${name} is unavailable`,
      );
    }
    return value;
  }
}
