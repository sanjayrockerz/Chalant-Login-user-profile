-- Keep eligibility and credential-revocation mutations behind the same
-- account SOC resource used by status changes, MATCH and DISCLOSURE.
CREATE FUNCTION "require_safety_fence_for_account_credential_mutation"()
RETURNS TRIGGER AS $$
DECLARE
  subject_id UUID;
  operation_id UUID;
  v_resource_key TEXT;
  expected_epoch BIGINT;
  current_epoch BIGINT;
  current_owner UUID;
  operation_state "SafetyOperationState";
  operation_type "SafetyOperationType";
  operation_subjects UUID[];
  operation_epoch TEXT;
BEGIN
  IF TG_TABLE_NAME = 'User' THEN
    IF NEW."isVerified" IS NOT DISTINCT FROM OLD."isVerified" THEN
      RETURN NEW;
    END IF;
    subject_id := NEW."id";
  ELSIF TG_TABLE_NAME = 'identity_sessions' THEN
    IF OLD."revoked_at" IS NOT NULL OR NEW."revoked_at" IS NULL THEN
      RETURN NEW;
    END IF;
    subject_id := NEW."user_id";
  ELSIF TG_TABLE_NAME = 'user_identities' THEN
    subject_id := OLD."user_id";
  ELSE
    RAISE EXCEPTION 'unsupported Auth credential safety trigger table'
      USING ERRCODE = '23514';
  END IF;

  BEGIN
    operation_id := NULLIF(current_setting('app.safety_operation_id', true), '')::UUID;
    expected_epoch := NULLIF(current_setting('app.safety_fence_epoch', true), '')::BIGINT;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'valid Auth SOC operation and fence epoch are required'
      USING ERRCODE = '23514';
  END;
  IF operation_id IS NULL OR expected_epoch IS NULL THEN
    RAISE EXCEPTION 'Auth account eligibility or credential revocation requires an SOC fence'
      USING ERRCODE = '23514';
  END IF;

  v_resource_key := 'account:' || lower(subject_id::TEXT);
  SELECT resource."owner_operation_id", resource."fence_epoch",
         operation."state", operation."operation_type", operation."subjects",
         operation."fence_epochs" ->> v_resource_key
    INTO current_owner, current_epoch, operation_state, operation_type,
         operation_subjects, operation_epoch
    FROM "safety_resources" AS resource
    JOIN "safety_operations" AS operation ON operation."id" = operation_id
   WHERE resource."resource_key" = v_resource_key;

  IF current_owner IS DISTINCT FROM operation_id
     OR operation_state IS DISTINCT FROM 'HELD'
     OR operation_type IS DISTINCT FROM 'ACCOUNT_MUTATION'
     OR operation_subjects IS DISTINCT FROM ARRAY[subject_id]::UUID[]
     OR current_epoch IS DISTINCT FROM expected_epoch
     OR operation_epoch IS DISTINCT FROM expected_epoch::TEXT THEN
    RAISE EXCEPTION 'Auth credential mutation does not own the current account SOC fence'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_email_verification_requires_safety_fence"
BEFORE UPDATE OF "isVerified" ON "User"
FOR EACH ROW EXECUTE FUNCTION "require_safety_fence_for_account_credential_mutation"();

CREATE TRIGGER "identity_session_revocation_requires_safety_fence"
BEFORE UPDATE OF "revoked_at" ON "identity_sessions"
FOR EACH ROW EXECUTE FUNCTION "require_safety_fence_for_account_credential_mutation"();

CREATE TRIGGER "user_identity_removal_requires_safety_fence"
BEFORE DELETE ON "user_identities"
FOR EACH ROW EXECUTE FUNCTION "require_safety_fence_for_account_credential_mutation"();
