-- ===========================================
-- DOCUMENTS REVIEW COLUMNS
-- Add review and auto-generation tracking to documents table
-- ===========================================

-- Source tracking for auto-generated documents
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS source_repo_id UUID REFERENCES repos(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS source_bundle_id UUID REFERENCES repo_doc_bundles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS source_repo_page_id UUID REFERENCES repo_doc_pages(id) ON DELETE SET NULL;

COMMENT ON COLUMN documents.source_repo_id IS 'For auto-generated docs: the source repository';
COMMENT ON COLUMN documents.source_bundle_id IS 'For auto-generated docs: the documentation bundle';
COMMENT ON COLUMN documents.source_repo_page_id IS 'For auto-generated docs: links to the repo_doc_pages entry';

-- Evidence and verification tracking
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS evidence_json JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS original_markdown TEXT,
ADD COLUMN IF NOT EXISTS verification_score INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS verification_issues JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN documents.evidence_json IS 'Evidence items: {file_path, excerpt, reason}[]';
COMMENT ON COLUMN documents.original_markdown IS 'Original AI-generated markdown before user edits';
COMMENT ON COLUMN documents.verification_score IS 'Verification score 0-100';
COMMENT ON COLUMN documents.verification_issues IS 'List of verification issues found';

-- Review workflow tracking
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS reviewed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN documents.needs_review IS 'True if document needs review (auto-generated or low verification score)';
COMMENT ON COLUMN documents.reviewed IS 'True if document has been reviewed and approved';
COMMENT ON COLUMN documents.reviewed_at IS 'When the document was marked as reviewed';
COMMENT ON COLUMN documents.reviewed_by IS 'User who reviewed the document';

-- User edit tracking
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS user_edited BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS user_edited_at TIMESTAMPTZ;

COMMENT ON COLUMN documents.user_edited IS 'True if document has been edited by a user after generation';
COMMENT ON COLUMN documents.user_edited_at IS 'When the document was last edited by a user';

-- Indexes for efficient filtering
CREATE INDEX IF NOT EXISTS idx_documents_source_repo
  ON documents(source_repo_id)
  WHERE source_repo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documents_needs_review
  ON documents(needs_review)
  WHERE needs_review = true;

CREATE INDEX IF NOT EXISTS idx_documents_reviewed
  ON documents(reviewed)
  WHERE reviewed = true;

CREATE INDEX IF NOT EXISTS idx_documents_source_bundle
  ON documents(source_bundle_id)
  WHERE source_bundle_id IS NOT NULL;
