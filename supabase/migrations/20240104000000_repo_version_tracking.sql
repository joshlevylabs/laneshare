-- ===========================================
-- REPO VERSION TRACKING & AUTO-SYNC
-- ===========================================

-- Add version tracking and auto-sync columns to repos table
ALTER TABLE public.repos
  ADD COLUMN IF NOT EXISTS selected_branch TEXT,
  ADD COLUMN IF NOT EXISTS last_synced_commit_sha TEXT,
  ADD COLUMN IF NOT EXISTS latest_commit_sha TEXT,
  ADD COLUMN IF NOT EXISTS has_updates BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_sync_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS webhook_id BIGINT;

-- Add comments for clarity
COMMENT ON COLUMN public.repos.selected_branch IS 'The branch selected for syncing (may differ from default_branch)';
COMMENT ON COLUMN public.repos.last_synced_commit_sha IS 'SHA of the commit when last sync completed';
COMMENT ON COLUMN public.repos.latest_commit_sha IS 'SHA of the latest commit detected via webhook';
COMMENT ON COLUMN public.repos.has_updates IS 'True when latest_commit_sha differs from last_synced_commit_sha';
COMMENT ON COLUMN public.repos.auto_sync_enabled IS 'If true, automatically sync when new commits are pushed';
COMMENT ON COLUMN public.repos.webhook_id IS 'GitHub webhook ID for cleanup on repo deletion';
