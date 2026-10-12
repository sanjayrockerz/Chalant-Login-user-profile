-- Add normalized username and display username columns; ensure unique index on normalizedUsername
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='"User"' AND column_name='normalizedUsername'
  ) THEN
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "normalizedUsername" varchar(255);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='"User"' AND column_name='displayUsername'
  ) THEN
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "displayUsername" varchar(255);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='"User"' AND column_name='usernameUpdatedAt'
  ) THEN
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "usernameUpdatedAt" timestamptz;
  END IF;
END$$;

-- Create unique index to prevent spoofing across locales
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = 'uq_user_normalized_username') THEN
    CREATE UNIQUE INDEX uq_user_normalized_username ON "User" ("normalizedUsername");
  END IF;
END$$;
