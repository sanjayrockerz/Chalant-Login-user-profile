CREATE TABLE "password_recovery_consumptions" (
  "token_hash" CHAR(64) NOT NULL,
  "consumed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_recovery_consumptions_pkey" PRIMARY KEY ("token_hash")
);
