-- ===========================================
-- REPO SYNC PROGRESS TRACKING
-- ===========================================

-- Add progress tracking columns to repos table
ALTER TABLE public.repos
  ADD COLUMN IF NOT EXISTS sync_progress INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sync_total INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sync_stage TEXT DEFAULT NULL;

-- Add comment for clarity
COMMENT ON COLUMN public.repos.sync_progress IS 'Number of files processed during sync';
COMMENT ON COLUMN public.repos.sync_total IS 'Total number of files to process during sync';
COMMENT ON COLUMN public.repos.sync_stage IS 'Current sync stage: discovering, indexing, embedding, generating_docs';
