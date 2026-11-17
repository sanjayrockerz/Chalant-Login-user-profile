import { randomUUID } from "crypto";
import { Prisma, UserAccountStatus } from "@prisma/client";

export const AUTH_LIFECYCLE_EVENT_TYPE = "auth.lifecycle.v1" as const;

interface AuthLifecycleEventBase {
  eventId: string;
  eventType: typeof AUTH_LIFECYCLE_EVENT_TYPE;
  version: 1;
  subject: string;
  occurredAt: string;
}

export interface AuthSessionRevokedEvent extends AuthLifecycleEventBase {
  action: "SESSION_REVOKED";
  scope: "SESSION";
  sessionId: string;
}

export interface AuthAccountStatusChangedEvent extends AuthLifecycleEventBase {
  action: "ACCOUNT_STATUS_CHANGED";
  scope: "ACCOUNT";
  accountStatus: UserAccountStatus;
  revision: number;
}

export type AuthLifecycleEvent =
  AuthSessionRevokedEvent | AuthAccountStatusChangedEvent;

export async function persistSessionRevokedEvent(
  transaction: Prisma.TransactionClient,
  subject: string,
  sessionId: string,
  occurredAt: Date,
): Promise<AuthSessionRevokedEvent> {
  const event: AuthSessionRevokedEvent = {
    eventId: randomUUID(),
    eventType: AUTH_LIFECYCLE_EVENT_TYPE,
    version: 1,
    subject,
    action: "SESSION_REVOKED",
    scope: "SESSION",
    sessionId,
    occurredAt: occurredAt.toISOString(),
  };
  await transaction.outboxEvent.create({
    data: {
      id: event.eventId,
      eventType: AUTH_LIFECYCLE_EVENT_TYPE,
      aggregateId: subject,
      payload: event as unknown as Prisma.InputJsonValue,
    },
  });
  return event;
}

export async function persistAccountStatusChangedEvent(
  transaction: Prisma.TransactionClient,
  subject: string,
  accountStatus: UserAccountStatus,
  revision: number,
  occurredAt: Date,
): Promise<AuthAccountStatusChangedEvent> {
  const event: AuthAccountStatusChangedEvent = {
    eventId: randomUUID(),
    eventType: AUTH_LIFECYCLE_EVENT_TYPE,
    version: 1,
    subject,
    action: "ACCOUNT_STATUS_CHANGED",
    scope: "ACCOUNT",
    accountStatus,
    revision,
    occurredAt: occurredAt.toISOString(),
  };
  await transaction.outboxEvent.create({
    data: {
      id: event.eventId,
      eventType: AUTH_LIFECYCLE_EVENT_TYPE,
      aggregateId: subject,
      payload: event as unknown as Prisma.InputJsonValue,
    },
  });
  return event;
}
