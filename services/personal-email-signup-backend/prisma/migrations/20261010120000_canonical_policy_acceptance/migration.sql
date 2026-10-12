BEGIN;

CREATE TABLE "policy_acceptance_history" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "policy_version" VARCHAR(64) NOT NULL,
  "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" VARCHAR(32) NOT NULL DEFAULT 'api',
  CONSTRAINT "policy_acceptance_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uniq_policy_acceptance_user_version"
  ON "policy_acceptance_history" ("user_id", "policy_version");
CREATE INDEX "idx_policy_acceptance_user"
  ON "policy_acceptance_history" ("user_id");
ALTER TABLE "policy_acceptance_history"
  ADD CONSTRAINT "policy_acceptance_history_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
