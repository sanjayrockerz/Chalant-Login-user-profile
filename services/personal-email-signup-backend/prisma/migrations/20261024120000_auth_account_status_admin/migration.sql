ALTER TABLE "User"
ADD COLUMN "account_status_version" INTEGER NOT NULL DEFAULT 0;

DROP INDEX "uniq_outbox_event_aggregate";

CREATE INDEX "idx_outbox_event_type_aggregate"
ON "chat_profile_provisioning_outbox"("event_type", "aggregate_id");

CREATE TABLE "account_status_audit" (
  "id" UUID NOT NULL,
  "target_user_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "from_status" "UserAccountStatus" NOT NULL,
  "to_status" "UserAccountStatus" NOT NULL,
  "version" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_status_audit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uniq_account_status_audit_target_version"
ON "account_status_audit"("target_user_id", "version");

CREATE INDEX "idx_account_status_audit_actor_created"
ON "account_status_audit"("actor_user_id", "created_at");
