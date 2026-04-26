-- Unified rank — emitted by nightly score-collapse job.
-- Collapses urgencyScore + revenuePotential + opportunityScore into a single
-- "score" 0-100, and adds dormant/claim-window signalling so the UI can
-- surface the dormant-leads story without per-request math.

ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "score" DOUBLE PRECISION;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "scoreReasons" JSONB DEFAULT '[]';
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "dormantFlag" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "claimWindowEndsAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "properties_score_idx"       ON "properties" ("score" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "properties_dormantFlag_idx" ON "properties" ("dormantFlag") WHERE "dormantFlag" = TRUE;
