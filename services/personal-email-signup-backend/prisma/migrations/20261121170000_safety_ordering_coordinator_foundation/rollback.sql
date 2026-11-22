-- Manual rollback for a disposable or explicitly approved database only.
-- Prisma migrate deploy does not apply down migrations automatically.
DROP TRIGGER IF EXISTS "safety_resources_epoch_monotonicity_guard" ON "safety_resources";
DROP FUNCTION IF EXISTS "guard_safety_resource_epoch_monotonicity"();
DROP TRIGGER IF EXISTS "safety_operations_resource_set_guard" ON "safety_operations";
DROP FUNCTION IF EXISTS "validate_safety_operation_resource_set"();
DROP TRIGGER IF EXISTS "safety_operations_state_transition_guard" ON "safety_operations";
DROP FUNCTION IF EXISTS "guard_safety_operation_state_transition"();
DROP TABLE IF EXISTS "safety_operation_waiters";
DROP TABLE IF EXISTS "safety_resources";
DROP TABLE IF EXISTS "safety_service_nonces";
DROP TABLE IF EXISTS "safety_operations";
DROP TYPE IF EXISTS "SafetyOperationState";
DROP TYPE IF EXISTS "SafetyOperationType";
