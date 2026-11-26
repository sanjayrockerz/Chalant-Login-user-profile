-- A deleted canonical Auth subject is terminal. Normal registration creates a
-- new UUID, while this guard prevents imports or repair writers from reusing
-- a tombstoned subject or mutating the permanent tombstone itself.
CREATE FUNCTION "prevent_tombstoned_user_reinstatement"()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "account_deletion_tombstones" AS tombstone
     WHERE tombstone."auth_subject" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'A tombstoned Auth subject cannot be reinstated'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_cannot_reuse_tombstoned_subject"
BEFORE INSERT ON "User"
FOR EACH ROW EXECUTE FUNCTION "prevent_tombstoned_user_reinstatement"();

CREATE FUNCTION "prevent_account_deletion_tombstone_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Auth account deletion tombstones are immutable'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "account_deletion_tombstones_are_immutable"
BEFORE UPDATE OR DELETE ON "account_deletion_tombstones"
FOR EACH ROW EXECUTE FUNCTION "prevent_account_deletion_tombstone_mutation"();
