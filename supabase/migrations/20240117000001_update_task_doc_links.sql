-- ===========================================
-- UPDATE TASK_DOC_LINKS to reference documents table
-- ===========================================

-- Add a new column for the new documents table
-- Keep the old doc_id column for backwards compatibility
ALTER TABLE public.task_doc_links
ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE;

-- Create index for the new column
CREATE INDEX IF NOT EXISTS task_doc_links_document_idx ON public.task_doc_links (document_id);

-- Update existing links where possible (matching by project_id and slug)
-- This migrates task_doc_links that reference doc_pages to the new documents table
DO $$
BEGIN
  UPDATE public.task_doc_links tdl
  SET document_id = d.id
  FROM public.doc_pages dp
  JOIN public.documents d ON d.project_id = dp.project_id AND d.slug = dp.slug
  WHERE tdl.doc_id = dp.id AND tdl.document_id IS NULL;
END$$;

-- Note: We keep both columns to maintain backwards compatibility
-- The API will prefer document_id when available, falling back to doc_id for legacy links
