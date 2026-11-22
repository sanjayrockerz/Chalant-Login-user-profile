CREATE TYPE "SafetyOperationType" AS ENUM (
  'ACCOUNT_MUTATION',
  'BLOCK',
  'UNBLOCK',
  'MATCH',
  'DISCLOSURE'
);

CREATE TYPE "SafetyOperationState" AS ENUM (
  'REQUESTED',
  'HELD',
  'CHECKED',
  'DENIED',
  'CHAT_COMMITTED',
  'CHAT_ABORTED',
  'SOURCE_COMMITTED',
  'CHAT_PAIR_TERMINATED',
  'RECOVERY_REQUIRED',
  'FINALIZED'
);

CREATE TABLE "safety_operations" (
  "id" UUID NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "operation_type" "SafetyOperationType" NOT NULL,
  "caller_service_id" VARCHAR(128) NOT NULL,
  "subjects" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "resource_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "waiter_tickets" JSONB,
  "state" "SafetyOperationState" NOT NULL DEFAULT 'REQUESTED',
  "source_revisions" JSONB,
  "fence_epochs" JSONB,
  "source_receipt" JSONB,
  "chat_receipt" JSONB,
  "failure_code" VARCHAR(96),
  "recovery_metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "safety_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "safety_operations_nonempty_resources" CHECK (cardinality("resource_keys") > 0)
);

CREATE INDEX "idx_safety_operations_recovery"
  ON "safety_operations"("state", "updated_at");

CREATE TABLE "safety_resources" (
  "resource_key" VARCHAR(512) NOT NULL,
  "next_ticket" BIGINT NOT NULL DEFAULT 0,
  "fence_epoch" BIGINT NOT NULL DEFAULT 0,
  "owner_operation_id" UUID,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "safety_resources_pkey" PRIMARY KEY ("resource_key"),
  CONSTRAINT "safety_resources_next_ticket_nonnegative" CHECK ("next_ticket" >= 0),
  CONSTRAINT "safety_resources_fence_epoch_nonnegative" CHECK ("fence_epoch" >= 0),
  CONSTRAINT "safety_resources_owner_operation_id_fkey" FOREIGN KEY ("owner_operation_id")
    REFERENCES "safety_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_safety_resource_owner"
  ON "safety_resources"("owner_operation_id");

CREATE TABLE "safety_operation_waiters" (
  "operation_id" UUID NOT NULL,
  "resource_key" VARCHAR(512) NOT NULL,
  "ticket" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "safety_operation_waiters_pkey" PRIMARY KEY ("operation_id", "resource_key"),
  CONSTRAINT "safety_operation_waiters_ticket_nonnegative" CHECK ("ticket" > 0),
  CONSTRAINT "safety_operation_waiters_operation_id_fkey" FOREIGN KEY ("operation_id")
    REFERENCES "safety_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "safety_operation_waiters_resource_key_fkey" FOREIGN KEY ("resource_key")
    REFERENCES "safety_resources"("resource_key") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "uq_safety_waiter_resource_ticket" UNIQUE ("resource_key", "ticket")
);

CREATE INDEX "idx_safety_waiter_fifo"
  ON "safety_operation_waiters"("resource_key", "ticket");

CREATE TABLE "safety_service_nonces" (
  "service_id" VARCHAR(128) NOT NULL,
  "key_id" VARCHAR(128) NOT NULL,
  "nonce_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "safety_service_nonces_pkey" PRIMARY KEY ("service_id", "key_id", "nonce_hash")
);

CREATE INDEX "idx_safety_service_nonces_expiry"
  ON "safety_service_nonces"("expires_at");

CREATE FUNCTION "guard_safety_operation_state_transition"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."request_hash" IS DISTINCT FROM OLD."request_hash"
     OR NEW."operation_type" IS DISTINCT FROM OLD."operation_type"
     OR NEW."caller_service_id" IS DISTINCT FROM OLD."caller_service_id"
     OR NEW."subjects" IS DISTINCT FROM OLD."subjects"
     OR NEW."resource_keys" IS DISTINCT FROM OLD."resource_keys" THEN
    RAISE EXCEPTION 'safety operation identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."source_receipt" IS NOT NULL AND NEW."source_receipt" IS DISTINCT FROM OLD."source_receipt" THEN
    RAISE EXCEPTION 'source receipt is immutable once recorded' USING ERRCODE = '23514';
  END IF;
  IF OLD."waiter_tickets" IS NOT NULL AND NEW."waiter_tickets" IS DISTINCT FROM OLD."waiter_tickets" THEN
    RAISE EXCEPTION 'waiter ticket vector is immutable once recorded' USING ERRCODE = '23514';
  END IF;
  IF OLD."fence_epochs" IS NOT NULL AND NEW."fence_epochs" IS DISTINCT FROM OLD."fence_epochs" THEN
    RAISE EXCEPTION 'fence epoch vector is immutable once assigned' USING ERRCODE = '23514';
  END IF;
  IF OLD."chat_receipt" IS NOT NULL AND NEW."chat_receipt" IS DISTINCT FROM OLD."chat_receipt" THEN
    RAISE EXCEPTION 'Chat receipt is immutable once recorded' USING ERRCODE = '23514';
  END IF;

  IF NEW."state" = OLD."state" THEN
    RETURN NEW;
  END IF;

  IF OLD."state" = 'FINALIZED' THEN
    RAISE EXCEPTION 'finalized safety operation is immutable' USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (OLD."state" = 'REQUESTED' AND NEW."state" IN ('HELD', 'DENIED', 'RECOVERY_REQUIRED')) OR
    (OLD."state" = 'HELD' AND NEW."state" IN ('CHECKED', 'DENIED', 'CHAT_COMMITTED', 'CHAT_ABORTED', 'SOURCE_COMMITTED', 'CHAT_PAIR_TERMINATED', 'RECOVERY_REQUIRED')) OR
    (OLD."state" = 'CHECKED' AND NEW."state" IN ('DENIED', 'CHAT_COMMITTED', 'CHAT_ABORTED', 'RECOVERY_REQUIRED')) OR
    (OLD."state" = 'DENIED' AND NEW."state" = 'FINALIZED') OR
    (OLD."state" = 'CHAT_COMMITTED' AND NEW."state" IN ('FINALIZED', 'RECOVERY_REQUIRED')) OR
    (OLD."state" = 'CHAT_ABORTED' AND NEW."state" IN ('FINALIZED', 'RECOVERY_REQUIRED')) OR
    (OLD."state" = 'SOURCE_COMMITTED' AND NEW."state" IN ('FINALIZED', 'RECOVERY_REQUIRED')) OR
    (OLD."state" = 'CHAT_PAIR_TERMINATED' AND NEW."state" IN ('SOURCE_COMMITTED', 'RECOVERY_REQUIRED')) OR
    (OLD."state" = 'RECOVERY_REQUIRED' AND NEW."state" IN ('HELD', 'CHECKED', 'DENIED', 'CHAT_COMMITTED', 'CHAT_ABORTED', 'SOURCE_COMMITTED', 'CHAT_PAIR_TERMINATED'))
  ) THEN
    RAISE EXCEPTION 'illegal safety operation state transition: % -> %', OLD."state", NEW."state"
      USING ERRCODE = '23514';
  END IF;

  IF NEW."state" = 'FINALIZED' THEN
    IF OLD."state" = 'SOURCE_COMMITTED' AND NEW."source_receipt" IS NULL THEN
      RAISE EXCEPTION 'source commit receipt required before finalization' USING ERRCODE = '23514';
    ELSIF OLD."state" = 'DENIED' AND (NEW."source_receipt" IS NULL OR NEW."failure_code" IS NULL) THEN
      RAISE EXCEPTION 'no-effect receipt required before denied finalization' USING ERRCODE = '23514';
    ELSIF OLD."state" = 'CHAT_COMMITTED' AND NEW."chat_receipt" IS NULL THEN
      RAISE EXCEPTION 'Chat commit receipt required before finalization' USING ERRCODE = '23514';
    ELSIF OLD."state" = 'CHAT_ABORTED' AND NEW."source_receipt" IS NULL AND NEW."chat_receipt" IS NULL THEN
      RAISE EXCEPTION 'durable abort proof required before finalization' USING ERRCODE = '23514';
    ELSIF OLD."state" NOT IN ('SOURCE_COMMITTED', 'DENIED', 'CHAT_COMMITTED', 'CHAT_ABORTED') THEN
      RAISE EXCEPTION 'operation cannot finalize from state %', OLD."state" USING ERRCODE = '23514';
    END IF;
    IF NEW."operation_type" IN ('BLOCK', 'UNBLOCK') AND NEW."chat_receipt" IS NULL THEN
      RAISE EXCEPTION 'pair operation requires a Chat termination receipt' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "safety_operations_state_transition_guard"
BEFORE UPDATE OF "state" ON "safety_operations"
FOR EACH ROW EXECUTE FUNCTION "guard_safety_operation_state_transition"();

CREATE FUNCTION "guard_safety_resource_epoch_monotonicity"()
RETURNS TRIGGER AS $$
DECLARE
  operation_state "SafetyOperationState";
BEGIN
  IF NEW."fence_epoch" < OLD."fence_epoch" OR NEW."next_ticket" < OLD."next_ticket" THEN
    RAISE EXCEPTION 'safety resource counters cannot decrease' USING ERRCODE = '23514';
  END IF;
  IF NEW."owner_operation_id" IS DISTINCT FROM OLD."owner_operation_id" THEN
    IF OLD."owner_operation_id" IS NULL AND NEW."owner_operation_id" IS NOT NULL THEN
      SELECT "state" INTO operation_state FROM "safety_operations" WHERE "id" = NEW."owner_operation_id";
      IF operation_state IS DISTINCT FROM 'HELD' OR NEW."fence_epoch" <> OLD."fence_epoch" + 1 THEN
        RAISE EXCEPTION 'resource grant requires HELD state and next fence epoch' USING ERRCODE = '23514';
      END IF;
    ELSIF OLD."owner_operation_id" IS NOT NULL AND NEW."owner_operation_id" IS NULL THEN
      SELECT "state" INTO operation_state FROM "safety_operations" WHERE "id" = OLD."owner_operation_id";
      IF operation_state IS DISTINCT FROM 'FINALIZED' OR NEW."fence_epoch" <> OLD."fence_epoch" THEN
        RAISE EXCEPTION 'resource release requires a finalized operation' USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'resource ownership cannot transfer directly' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "safety_resources_epoch_monotonicity_guard"
BEFORE UPDATE ON "safety_resources"
FOR EACH ROW EXECUTE FUNCTION "guard_safety_resource_epoch_monotonicity"();

CREATE FUNCTION "validate_safety_operation_resource_set"()
RETURNS TRIGGER AS $$
DECLARE
  current_state "SafetyOperationState";
  expected_count INTEGER;
  owned_count INTEGER;
  waiting_count INTEGER;
BEGIN
  SELECT "state", cardinality("resource_keys")
    INTO current_state, expected_count
    FROM "safety_operations" WHERE "id" = NEW."id";
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO owned_count FROM "safety_resources"
    WHERE "owner_operation_id" = NEW."id";
  SELECT count(*) INTO waiting_count FROM "safety_operation_waiters"
    WHERE "operation_id" = NEW."id";

  IF current_state IN ('HELD', 'CHECKED', 'CHAT_COMMITTED', 'CHAT_ABORTED', 'SOURCE_COMMITTED', 'CHAT_PAIR_TERMINATED') THEN
    IF owned_count <> expected_count OR waiting_count <> 0 THEN
      RAISE EXCEPTION 'active safety operation must own its complete resource set' USING ERRCODE = '23514';
    END IF;
  ELSIF current_state = 'REQUESTED' THEN
    IF waiting_count <> expected_count OR owned_count <> 0 THEN
      RAISE EXCEPTION 'requested safety operation must have its complete waiter set' USING ERRCODE = '23514';
    END IF;
  ELSIF current_state = 'RECOVERY_REQUIRED' THEN
    IF NOT ((owned_count = expected_count AND waiting_count = 0) OR
            (waiting_count = expected_count AND owned_count = 0)) THEN
      RAISE EXCEPTION 'recovery operation must retain either all ownership or all waiters' USING ERRCODE = '23514';
    END IF;
  ELSIF current_state = 'FINALIZED' THEN
    IF owned_count <> 0 OR waiting_count <> 0 THEN
      RAISE EXCEPTION 'finalized safety operation cannot retain resources or waiters' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "safety_operations_resource_set_guard"
AFTER INSERT OR UPDATE ON "safety_operations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_safety_operation_resource_set"();
