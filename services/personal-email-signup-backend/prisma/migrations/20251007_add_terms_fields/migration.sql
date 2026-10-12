-- Migration: add termsVersion and termsAcceptedAt to users
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS terms_version varchar(64);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
