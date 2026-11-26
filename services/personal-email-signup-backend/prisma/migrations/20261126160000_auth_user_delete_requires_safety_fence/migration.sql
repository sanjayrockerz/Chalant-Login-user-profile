-- A direct SQL DELETE must not bypass the irreversible, receipt-backed Auth
-- deletion transaction. The registered deletion service sets these
-- transaction-local values only after obtaining the account SOC resource and
-- inserts the tombstone before deleting the User row.
CREATE FUNCTION "require_safety_fence_for_user_delete"()
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
  tombstone_revision BIGINT;
BEGIN
  BEGIN
    operation_id := NULLIF(current_setting('app.safety_operation_id', true), '')::UUID;
    expected_epoch := NULLIF(current_setting('app.safety_fence_epoch', true), '')::BIGINT;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'valid Auth SOC operation and fence epoch are required for User deletion'
      USING ERRCODE = '23514';
  END;

  IF operation_id IS NULL OR expected_epoch IS NULL THEN
    RAISE EXCEPTION 'User deletion requires the Auth SOC account fence'
      USING ERRCODE = '23514';
  END IF;

  account_resource_key := 'account:' || lower(OLD."id"::TEXT);
  SELECT resource."owner_operation_id", resource."fence_epoch",
         operation."state", operation."operation_type", operation."subjects",
         operation."fence_epochs" ->> account_resource_key,
         tombstone."lifecycle_revision"
    INTO current_owner, current_epoch, operation_state, operation_type,
         operation_subjects, operation_epoch, tombstone_revision
    FROM "safety_resources" AS resource
    JOIN "safety_operations" AS operation ON operation."id" = operation_id
    LEFT JOIN "account_deletion_tombstones" AS tombstone
      ON tombstone."auth_subject" = OLD."id"
   WHERE resource."resource_key" = account_resource_key;

  IF current_owner IS DISTINCT FROM operation_id
     OR operation_state IS DISTINCT FROM 'HELD'
     OR operation_type IS DISTINCT FROM 'ACCOUNT_MUTATION'
     OR operation_subjects IS DISTINCT FROM ARRAY[OLD."id"]::UUID[]
     OR current_epoch IS DISTINCT FROM expected_epoch
     OR operation_epoch IS DISTINCT FROM expected_epoch::TEXT
     OR tombstone_revision IS DISTINCT FROM (OLD."account_status_version" + 1)::BIGINT
     OR NOT EXISTS (
       SELECT 1 FROM "safety_operations" AS deletion
        WHERE deletion."id" = operation_id
          AND deletion."request_metadata" ->> 'purpose' = 'ACCOUNT_DELETION_V1'
     ) THEN
    RAISE EXCEPTION 'User deletion does not own a matching Auth deletion SOC fence and tombstone'
      USING ERRCODE = '23514';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_delete_requires_safety_fence"
BEFORE DELETE ON "User"
FOR EACH ROW EXECUTE FUNCTION "require_safety_fence_for_user_delete"();
