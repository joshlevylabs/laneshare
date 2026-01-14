-- ===========================================
-- DOCUMENTS: User-Added Documentation System
-- ===========================================

-- Document categories (fixed set for MVP)
CREATE TYPE document_category AS ENUM (
  'architecture',
  'api',
  'feature_guide',
  'runbook',
  'decision',
  'onboarding',
  'meeting_notes',
  'other'
);

-- Document builder session status
CREATE TYPE document_builder_status AS ENUM (
  'BASICS',
  'INTERVIEW',
  'CONTEXT',
  'PROMPTS',
  'EDITING',
  'COMPLETED'
);

-- ===========================================
-- DOCUMENTS TABLE
-- ===========================================

CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  category document_category NOT NULL DEFAULT 'other',
  description TEXT,
  tags TEXT[] DEFAULT '{}',
  markdown TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, slug)
);

CREATE INDEX documents_project_idx ON public.documents (project_id, category);
CREATE INDEX documents_project_updated_idx ON public.documents (project_id, updated_at DESC);
CREATE INDEX documents_slug_idx ON public.documents (project_id, slug);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_updated_at_trigger
  BEFORE UPDATE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION update_documents_updated_at();

-- ===========================================
-- DOCUMENT BUILDER SESSIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS public.document_builder_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Basics (Step 1)
  title TEXT,
  category document_category,
  description TEXT,
  tags TEXT[] DEFAULT '{}',

  -- Interview (Step 2) - Q&A transcript and structured answers
  interview_messages JSONB DEFAULT '[]',
  interview_answers JSONB DEFAULT '{}',

  -- Context Selection (Step 3)
  selected_repo_ids UUID[] DEFAULT '{}',
  selected_service_ids UUID[] DEFAULT '{}',
  selected_system_ids UUID[] DEFAULT '{}',
  selected_task_ids UUID[] DEFAULT '{}',
  selected_doc_ids UUID[] DEFAULT '{}',
  context_keywords TEXT[] DEFAULT '{}',

  -- Generated Output (Step 4)
  outline_markdown TEXT,
  generated_prompts JSONB DEFAULT '[]',
  context_pack_json JSONB DEFAULT '{}',

  -- Status tracking
  status document_builder_status NOT NULL DEFAULT 'BASICS',
  document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX builder_sessions_project_idx ON public.document_builder_sessions (project_id, created_at DESC);
CREATE INDEX builder_sessions_creator_idx ON public.document_builder_sessions (created_by);
CREATE INDEX builder_sessions_status_idx ON public.document_builder_sessions (project_id, status);

CREATE TRIGGER builder_sessions_updated_at_trigger
  BEFORE UPDATE ON public.document_builder_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_documents_updated_at();

-- ===========================================
-- DOCUMENT REFERENCES (Generic linking)
-- ===========================================

CREATE TABLE IF NOT EXISTS public.document_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  -- Source entity
  source_type TEXT NOT NULL CHECK (source_type IN ('task', 'system', 'document')),
  source_id UUID NOT NULL,

  -- Target document
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,

  -- Reference kind (semantic relationship)
  kind TEXT NOT NULL DEFAULT 'related' CHECK (kind IN ('related', 'spec', 'runbook', 'adr', 'guide', 'reference')),

  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate links
  UNIQUE(source_type, source_id, document_id)
);

CREATE INDEX doc_refs_source_idx ON public.document_references (source_type, source_id);
CREATE INDEX doc_refs_document_idx ON public.document_references (document_id);
CREATE INDEX doc_refs_project_idx ON public.document_references (project_id);

-- ===========================================
-- ENABLE RLS
-- ===========================================

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_builder_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_references ENABLE ROW LEVEL SECURITY;

-- ===========================================
-- RLS POLICIES - DOCUMENTS
-- ===========================================

CREATE POLICY "Project members can view documents"
  ON public.documents FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create documents"
  ON public.documents FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY "Project members can update documents"
  ON public.documents FOR UPDATE
  USING (public.is_project_member(project_id));

CREATE POLICY "Admins can delete documents"
  ON public.documents FOR DELETE
  USING (public.is_project_admin(project_id));

-- ===========================================
-- RLS POLICIES - BUILDER SESSIONS
-- ===========================================

CREATE POLICY "Users can view their own builder sessions"
  ON public.document_builder_sessions FOR SELECT
  USING (created_by = auth.uid() OR public.is_project_member(project_id));

CREATE POLICY "Project members can create builder sessions"
  ON public.document_builder_sessions FOR INSERT
  WITH CHECK (public.is_project_member(project_id) AND auth.uid() = created_by);

CREATE POLICY "Creators can update their builder sessions"
  ON public.document_builder_sessions FOR UPDATE
  USING (created_by = auth.uid());

CREATE POLICY "Creators can delete their builder sessions"
  ON public.document_builder_sessions FOR DELETE
  USING (created_by = auth.uid());

-- ===========================================
-- RLS POLICIES - DOCUMENT REFERENCES
-- ===========================================

CREATE POLICY "Project members can view document references"
  ON public.document_references FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create document references"
  ON public.document_references FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY "Project members can delete document references"
  ON public.document_references FOR DELETE
  USING (public.is_project_member(project_id));

-- ===========================================
-- MIGRATE EXISTING DOC_PAGES (optional)
-- ===========================================
-- Convert existing doc_pages to documents table as 'legacy' entries
-- Note: Run this only if doc_pages has data you want to preserve

DO $$
DECLARE
  doc_exists BOOLEAN;
BEGIN
  -- Check if doc_pages table exists
  SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'doc_pages'
  ) INTO doc_exists;

  IF doc_exists THEN
    -- Migrate doc_pages to documents
    INSERT INTO public.documents (project_id, title, slug, category, markdown, created_at, updated_at)
    SELECT
      project_id,
      title,
      slug,
      CASE category::text
        WHEN 'architecture' THEN 'architecture'::document_category
        WHEN 'features' THEN 'feature_guide'::document_category
        WHEN 'decisions' THEN 'decision'::document_category
        WHEN 'status' THEN 'other'::document_category
        WHEN 'services' THEN 'api'::document_category
        WHEN 'apis' THEN 'api'::document_category
        ELSE 'other'::document_category
      END,
      markdown,
      created_at,
      updated_at
    FROM public.doc_pages
    ON CONFLICT (project_id, slug) DO NOTHING;
  END IF;
END$$;
