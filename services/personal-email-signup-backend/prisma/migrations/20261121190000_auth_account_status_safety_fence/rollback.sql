-- Manual rollback for a disposable or explicitly approved database only.
DROP TRIGGER IF EXISTS "users_account_status_requires_safety_fence" ON "User";
DROP FUNCTION IF EXISTS "require_safety_fence_for_account_status"();
