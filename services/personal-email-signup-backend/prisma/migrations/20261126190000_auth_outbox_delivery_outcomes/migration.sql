BEGIN;

ALTER TABLE "chat_profile_provisioning_outbox"
  ADD COLUMN "terminal_at" TIMESTAMPTZ(6),
  ADD COLUMN "delivery_outcome" VARCHAR(48);

UPDATE "chat_profile_provisioning_outbox"
   SET "terminal_at" = "delivered_at",
       "delivery_outcome" = 'APPLIED'
 WHERE "delivered_at" IS NOT NULL;

CREATE INDEX "idx_outbox_event_schedule"
  ON "chat_profile_provisioning_outbox" ("event_type", "next_attempt_at", "created_at");

CREATE INDEX "idx_outbox_event_aggregate_order"
  ON "chat_profile_provisioning_outbox" ("event_type", "aggregate_id", "created_at", "id");

COMMIT;
