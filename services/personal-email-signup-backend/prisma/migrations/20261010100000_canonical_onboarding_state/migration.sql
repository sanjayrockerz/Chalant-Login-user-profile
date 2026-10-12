-- Additive canonical profile/onboarding state. Historical migrations remain unchanged.
BEGIN;

CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE');

ALTER TABLE "User"
  ADD COLUMN "onboarding_status" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "onboarding_completed_at" TIMESTAMP(3);

COMMIT;
