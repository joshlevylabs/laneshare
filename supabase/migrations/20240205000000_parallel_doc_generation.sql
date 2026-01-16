-- ===========================================
-- PARALLEL DOCUMENT GENERATION
-- Schema updates for 7-terminal parallel doc generation
-- ===========================================

-- Add columns to bridge_prompt_queue for doc generation
ALTER TABLE bridge_prompt_queue
ADD COLUMN IF NOT EXISTS prompt_type TEXT DEFAULT 'general',
ADD COLUMN IF NOT EXISTS result_bundle_id UUID REFERENCES repo_doc_bundles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS doc_type TEXT,
ADD COLUMN IF NOT EXISTS streaming_output TEXT;

COMMENT ON COLUMN bridge_prompt_queue.prompt_type IS 'Type of prompt: general, doc_generation';
COMMENT ON COLUMN bridge_prompt_queue.result_bundle_id IS 'For doc_generation prompts, the target bundle';
COMMENT ON COLUMN bridge_prompt_queue.doc_type IS 'Document type: AGENTS_SUMMARY, ARCHITECTURE, FEATURES, APIS, RUNBOOK, ADRS, SUMMARY';
COMMENT ON COLUMN bridge_prompt_queue.streaming_output IS 'Accumulated output during streaming generation';

-- Add columns to repo_doc_bundles for parallel generation tracking
ALTER TABLE repo_doc_bundles
ADD COLUMN IF NOT EXISTS agent_context_files JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS generation_mode TEXT DEFAULT 'legacy';

COMMENT ON COLUMN repo_doc_bundles.agent_context_files IS 'List of agents.md files discovered during generation';
COMMENT ON COLUMN repo_doc_bundles.generation_mode IS 'Generation mode: legacy (single API call) or parallel (7 terminals)';

-- Add columns to repo_doc_pages for verification tracking
ALTER TABLE repo_doc_pages
ADD COLUMN IF NOT EXISTS original_markdown TEXT,
ADD COLUMN IF NOT EXISTS verification_score INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS verification_issues JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN repo_doc_pages.original_markdown IS 'Original generated markdown before user edits';
COMMENT ON COLUMN repo_doc_pages.verification_score IS 'Score from verification pass (0-100)';
COMMENT ON COLUMN repo_doc_pages.verification_issues IS 'List of verification issues found';
COMMENT ON COLUMN repo_doc_pages.reviewed_at IS 'When the page was marked as reviewed';
COMMENT ON COLUMN repo_doc_pages.reviewed_by IS 'User who marked the page as reviewed';

-- Index for doc generation queries on bridge_prompt_queue
CREATE INDEX IF NOT EXISTS idx_bridge_prompt_queue_bundle
  ON bridge_prompt_queue(result_bundle_id, doc_type)
  WHERE prompt_type = 'doc_generation';

-- Index for finding prompts by doc type
CREATE INDEX IF NOT EXISTS idx_bridge_prompt_queue_doc_type
  ON bridge_prompt_queue(doc_type)
  WHERE doc_type IS NOT NULL;

-- Index for generation mode queries
CREATE INDEX IF NOT EXISTS idx_repo_doc_bundles_generation_mode
  ON repo_doc_bundles(generation_mode);

-- Index for verification queries
CREATE INDEX IF NOT EXISTS idx_repo_doc_pages_verification
  ON repo_doc_pages(verification_score)
  WHERE verification_score < 80;

-- Index for reviewed pages
CREATE INDEX IF NOT EXISTS idx_repo_doc_pages_reviewed
  ON repo_doc_pages(reviewed_at)
  WHERE reviewed_at IS NOT NULL;
