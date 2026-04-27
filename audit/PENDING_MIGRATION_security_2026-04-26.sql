-- ============================================================================
-- PENDING MIGRATION — security hardening 2026-04-26
-- ============================================================================
--
-- This migration is intentionally NOT applied automatically. It must be run
-- manually after coordinating a deploy because it:
--   1. Renames the Plan enum (STARTER/PROFESSIONAL → SCOUT/BUSINESS/PRO)
--      which the code already writes. Until this lands, every paid checkout
--      webhook crashes mid-handler.
--   2. Adds ProcessedStripeEvent for idempotent webhook handling (replays
--      no longer double-grant entitlements).
--   3. Adds Organization.subscriptionStatus + currentPeriodEnd so cancellation
--      / refund can revoke access.
--   4. Adds User.tokenVersion to invalidate all access JWTs on logout /
--      password change.
--   5. Adds Session.tokenFamily for refresh-token reuse detection.
--   6. Truncates `sessions` table — every existing refresh token is plaintext
--      and incompatible with the new SHA-256-hashed storage. All users are
--      logged out and must re-authenticate. Acceptable cost; coordinate with
--      a maintenance-window banner on the frontend.
--
-- HOW TO APPLY (after merging the harden branch and updating prisma/schema.prisma):
--   1. Update apps/backend/prisma/schema.prisma to match the changes below
--      (also documented in PENDING_MIGRATION_unify_plans_oauth_reveals.diff).
--   2. cd apps/backend && npx prisma migrate dev --name security_2026_04_26
--   3. Review the generated SQL against this file; it should match.
--   4. Deploy.
--
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Plan enum migration (STARTER/PROFESSIONAL → SCOUT/BUSINESS/PRO)
-- ----------------------------------------------------------------------------
-- Add new enum values; map old → new on existing rows; drop old values.
ALTER TYPE "Plan" ADD VALUE IF NOT EXISTS 'SCOUT';
ALTER TYPE "Plan" ADD VALUE IF NOT EXISTS 'BUSINESS';
ALTER TYPE "Plan" ADD VALUE IF NOT EXISTS 'PRO';
COMMIT;

BEGIN;
UPDATE "organizations" SET "plan" = 'SCOUT'    WHERE "plan" = 'STARTER';
UPDATE "organizations" SET "plan" = 'BUSINESS' WHERE "plan" = 'PROFESSIONAL';

-- Postgres can't drop enum values directly. Recreate:
ALTER TYPE "Plan" RENAME TO "Plan_old";
CREATE TYPE "Plan" AS ENUM ('SCOUT', 'BUSINESS', 'PRO', 'ENTERPRISE');
ALTER TABLE "organizations" ALTER COLUMN "plan" TYPE "Plan" USING ("plan"::text::"Plan");
ALTER TABLE "organizations" ALTER COLUMN "plan" SET DEFAULT 'SCOUT';
DROP TYPE "Plan_old";

-- ----------------------------------------------------------------------------
-- 2. ProcessedStripeEvent — idempotent webhook handling
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "processed_stripe_events" (
  "id"         TEXT      NOT NULL PRIMARY KEY,
  "type"       TEXT      NOT NULL,
  "receivedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "processed_stripe_events_receivedAt_idx"
  ON "processed_stripe_events" ("receivedAt");

-- ----------------------------------------------------------------------------
-- 3. Subscription lifecycle columns on Organization
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "SubscriptionStatus" AS ENUM ('NONE','TRIALING','ACTIVE','PAST_DUE','CANCELED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" TEXT,
  ADD COLUMN IF NOT EXISTS "subscriptionStatus"   "SubscriptionStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "currentPeriodStart"   TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS "currentPeriodEnd"     TIMESTAMP;

-- ----------------------------------------------------------------------------
-- 4. User.tokenVersion — invalidate all access JWTs on logout / password change
-- ----------------------------------------------------------------------------
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "tokenVersion" INT NOT NULL DEFAULT 0;

-- ----------------------------------------------------------------------------
-- 5. Session.tokenFamily — refresh-token reuse detection
-- ----------------------------------------------------------------------------
ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "tokenFamily" TEXT;
CREATE INDEX IF NOT EXISTS "sessions_tokenFamily_idx" ON "sessions" ("tokenFamily");

-- ----------------------------------------------------------------------------
-- 6. Truncate sessions — existing tokens are plaintext, incompatible with
--    the new SHA-256-hashed storage in AuthService.saveSession/refresh.
-- ----------------------------------------------------------------------------
TRUNCATE TABLE "sessions";

COMMIT;

-- After applying:
--   - All currently-logged-in users will be silently logged out on next /refresh.
--   - The Plan enum mismatch is resolved; checkout webhooks will succeed.
--   - Webhook replays will be deduped via ProcessedStripeEvent.
--   - Cancel/refund can update subscriptionStatus and downgrade plan.
