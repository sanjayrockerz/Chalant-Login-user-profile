-- Durable Auth-to-Chat profile provisioning intent. Account creation and this
-- row are written in the same Auth database transaction.
BEGIN;

CREATE TABLE "chat_profile_provisioning_outbox" (
  "id" UUID NOT NULL,
  "event_type" VARCHAR(128) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimed_at" TIMESTAMP(3),
  "claim_token" UUID,
  "delivered_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_profile_provisioning_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uniq_outbox_event_aggregate"
  ON "chat_profile_provisioning_outbox" ("event_type", "aggregate_id");
CREATE INDEX "idx_outbox_event_pending"
  ON "chat_profile_provisioning_outbox" ("delivered_at", "next_attempt_at", "claimed_at");

COMMIT;
