-- Migration: Add progress_json column to repo_doc_bundles for real-time progress tracking

-- Add progress_json column to track generation progress
ALTER TABLE public.repo_doc_bundles
ADD COLUMN IF NOT EXISTS progress_json JSONB DEFAULT NULL;

COMMENT ON COLUMN public.repo_doc_bundles.progress_json IS 'Real-time progress tracking during documentation generation. Contains stage, message, pagesGenerated, round, etc. Null when not generating.';

-- Add index for efficient querying of in-progress bundles
CREATE INDEX IF NOT EXISTS idx_repo_doc_bundles_progress
  ON public.repo_doc_bundles(status)
  WHERE status = 'GENERATING';
