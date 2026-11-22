-- Require a live Auth-owned SOC account fence for status/version changes.
-- The source mutation and SOC finalization must occur in the same transaction.
CREATE FUNCTION "require_safety_fence_for_account_status"()
RETURNS TRIGGER AS $$
DECLARE
  operation_id UUID;
  account_resource_key TEXT;
  expected_epoch BIGINT;
  current_epoch BIGINT;
  current_owner UUID;
  operation_state "SafetyOperationState";
  operation_type "SafetyOperationType";
  operation_subjects UUID[];
  operation_epoch TEXT;
BEGIN
  IF NEW."accountStatus" IS NOT DISTINCT FROM OLD."accountStatus"
     AND NEW."account_status_version" IS NOT DISTINCT FROM OLD."account_status_version" THEN
    RETURN NEW;
  END IF;

  BEGIN
    operation_id := NULLIF(current_setting('app.safety_operation_id', true), '')::UUID;
    expected_epoch := NULLIF(current_setting('app.safety_fence_epoch', true), '')::BIGINT;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'valid Auth SOC operation and fence epoch are required'
      USING ERRCODE = '23514';
  END;

  IF operation_id IS NULL OR expected_epoch IS NULL THEN
    RAISE EXCEPTION 'Auth account status mutation requires an SOC fence'
      USING ERRCODE = '23514';
  END IF;

  account_resource_key := 'account:' || lower(NEW."id"::TEXT);
  SELECT resource."owner_operation_id", resource."fence_epoch",
         operation."state", operation."operation_type", operation."subjects",
         operation."fence_epochs" ->> account_resource_key
    INTO current_owner, current_epoch, operation_state, operation_type,
         operation_subjects, operation_epoch
    FROM "safety_resources" AS resource
    JOIN "safety_operations" AS operation
      ON operation."id" = operation_id
   WHERE resource."resource_key" = account_resource_key;

  IF current_owner IS DISTINCT FROM operation_id
     OR operation_state IS DISTINCT FROM 'HELD'
     OR operation_type IS DISTINCT FROM 'ACCOUNT_MUTATION'
     OR operation_subjects IS DISTINCT FROM ARRAY[NEW."id"]::UUID[]
     OR current_epoch IS DISTINCT FROM expected_epoch
     OR operation_epoch IS DISTINCT FROM expected_epoch::TEXT THEN
    RAISE EXCEPTION 'Auth account status mutation does not own the current SOC fence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_account_status_requires_safety_fence"
BEFORE UPDATE OF "accountStatus", "account_status_version" ON "User"
FOR EACH ROW EXECUTE FUNCTION "require_safety_fence_for_account_status"();
