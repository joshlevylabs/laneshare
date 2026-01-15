-- Migration: Add review tracking and edit capabilities for doc pages
-- Supports marking individual pages as reviewed and tracking original vs edited content

-- Add reviewed status columns to repo_doc_pages
ALTER TABLE public.repo_doc_pages
ADD COLUMN IF NOT EXISTS reviewed BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Add original_markdown to track auto-generated content vs user edits
-- This allows comparing what AI generated vs what user edited
ALTER TABLE public.repo_doc_pages
ADD COLUMN IF NOT EXISTS original_markdown TEXT,
ADD COLUMN IF NOT EXISTS verification_score INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS verification_issues JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.repo_doc_pages.reviewed IS 'User has verified this page content is correct';
COMMENT ON COLUMN public.repo_doc_pages.reviewed_at IS 'When the page was marked as reviewed';
COMMENT ON COLUMN public.repo_doc_pages.reviewed_by IS 'Who marked the page as reviewed';
COMMENT ON COLUMN public.repo_doc_pages.original_markdown IS 'Original AI-generated markdown before user edits';
COMMENT ON COLUMN public.repo_doc_pages.verification_score IS 'Evidence verification score (0-100)';
COMMENT ON COLUMN public.repo_doc_pages.verification_issues IS 'List of verification issues found';

-- Create index for reviewed pages queries
CREATE INDEX IF NOT EXISTS idx_repo_doc_pages_reviewed ON public.repo_doc_pages(reviewed);

-- Add verification_json to bundles for overall verification results
ALTER TABLE public.repo_doc_bundles
ADD COLUMN IF NOT EXISTS verification_json JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.repo_doc_bundles.verification_json IS 'Overall verification results (score, issue counts)';
