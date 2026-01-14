-- ===========================================
-- FIX MIGRATION: Create missing context tables
-- This migration safely creates tables that may not exist
-- ===========================================

-- ===========================================
-- TASK CONTEXT MESSAGES (from 20240106)
-- ===========================================

CREATE TABLE IF NOT EXISTS public.task_context_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('USER', 'AI')),
  content TEXT NOT NULL,
  suggestions JSONB DEFAULT '[]',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS task_context_messages_task_idx ON public.task_context_messages (task_id, created_at);
CREATE INDEX IF NOT EXISTS task_context_messages_project_idx ON public.task_context_messages (project_id);

-- ===========================================
-- TASK SERVICE LINKS (from 20240106)
-- ===========================================

CREATE TABLE IF NOT EXISTS public.task_service_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.project_service_connections(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, connection_id)
);

CREATE INDEX IF NOT EXISTS task_service_links_task_idx ON public.task_service_links (task_id);
CREATE INDEX IF NOT EXISTS task_service_links_connection_idx ON public.task_service_links (connection_id);
CREATE INDEX IF NOT EXISTS task_service_links_project_idx ON public.task_service_links (project_id);

-- ===========================================
-- TASK ASSET LINKS (from 20240106)
-- ===========================================

CREATE TABLE IF NOT EXISTS public.task_asset_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.service_assets(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, asset_id)
);

CREATE INDEX IF NOT EXISTS task_asset_links_task_idx ON public.task_asset_links (task_id);
CREATE INDEX IF NOT EXISTS task_asset_links_asset_idx ON public.task_asset_links (asset_id);
CREATE INDEX IF NOT EXISTS task_asset_links_project_idx ON public.task_asset_links (project_id);

-- ===========================================
-- TASK DOC LINKS (from 20240106)
-- ===========================================

CREATE TABLE IF NOT EXISTS public.task_doc_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  doc_id UUID NOT NULL REFERENCES public.doc_pages(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, doc_id)
);

CREATE INDEX IF NOT EXISTS task_doc_links_task_idx ON public.task_doc_links (task_id);
CREATE INDEX IF NOT EXISTS task_doc_links_doc_idx ON public.task_doc_links (doc_id);
CREATE INDEX IF NOT EXISTS task_doc_links_project_idx ON public.task_doc_links (project_id);

-- ===========================================
-- TASK REPO LINKS (from 20240106)
-- ===========================================

CREATE TABLE IF NOT EXISTS public.task_repo_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, repo_id)
);

CREATE INDEX IF NOT EXISTS task_repo_links_task_idx ON public.task_repo_links (task_id);
CREATE INDEX IF NOT EXISTS task_repo_links_repo_idx ON public.task_repo_links (repo_id);
CREATE INDEX IF NOT EXISTS task_repo_links_project_idx ON public.task_repo_links (project_id);

-- ===========================================
-- TASK FEATURE LINKS (from 20240107)
-- ===========================================

CREATE TABLE IF NOT EXISTS public.task_feature_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  feature_id UUID NOT NULL REFERENCES public.architecture_features(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, feature_id)
);

CREATE INDEX IF NOT EXISTS task_feature_links_task_idx ON public.task_feature_links (task_id);
CREATE INDEX IF NOT EXISTS task_feature_links_feature_idx ON public.task_feature_links (feature_id);
CREATE INDEX IF NOT EXISTS task_feature_links_project_idx ON public.task_feature_links (project_id);

-- ===========================================
-- TASK TICKET LINKS (from 20240107)
-- ===========================================

CREATE TABLE IF NOT EXISTS public.task_ticket_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  linked_task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL DEFAULT 'related' CHECK (link_type IN ('related', 'blocks', 'blocked_by', 'duplicates', 'duplicated_by')),
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, linked_task_id),
  CHECK (task_id != linked_task_id)
);

CREATE INDEX IF NOT EXISTS task_ticket_links_task_idx ON public.task_ticket_links (task_id);
CREATE INDEX IF NOT EXISTS task_ticket_links_linked_task_idx ON public.task_ticket_links (linked_task_id);
CREATE INDEX IF NOT EXISTS task_ticket_links_project_idx ON public.task_ticket_links (project_id);

-- ===========================================
-- ENABLE RLS (safe to run multiple times)
-- ===========================================

ALTER TABLE public.task_context_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_service_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_asset_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_doc_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_repo_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_feature_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_ticket_links ENABLE ROW LEVEL SECURITY;

-- ===========================================
-- RLS POLICIES (using DO blocks to check existence)
-- ===========================================

-- task_context_messages policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_context_messages' AND policyname = 'Project members can view task context messages') THEN
    CREATE POLICY "Project members can view task context messages"
      ON public.task_context_messages FOR SELECT
      USING (public.is_project_member(project_id));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_context_messages' AND policyname = 'Project members can create task context messages') THEN
    CREATE POLICY "Project members can create task context messages"
      ON public.task_context_messages FOR INSERT
      WITH CHECK (public.is_project_member(project_id));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_context_messages' AND policyname = 'Message creators and admins can delete task context messages') THEN
    CREATE POLICY "Message creators and admins can delete task context messages"
      ON public.task_context_messages FOR DELETE
      USING (created_by = auth.uid() OR public.is_project_admin(project_id));
  END IF;
END$$;

-- task_service_links policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_service_links' AND policyname = 'Project members can view task service links') THEN
    CREATE POLICY "Project members can view task service links"
      ON public.task_service_links FOR SELECT
      USING (public.is_project_member(project_id));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_service_links' AND policyname = 'Project members can create task service links') THEN
    CREATE POLICY "Project members can create task service links"
      ON public.task_service_links FOR INSERT
      WITH CHECK (public.is_project_member(project_id) AND auth.uid() = created_by);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_service_links' AND policyname = 'Link creators and admins can delete task service links') THEN
    CREATE POLICY "Link creators and admins can delete task service links"
      ON public.task_service_links FOR DELETE
      USING (created_by = auth.uid() OR public.is_project_admin(project_id));
  END IF;
END$$;

-- task_asset_links policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_asset_links' AND policyname = 'Project members can view task asset links') THEN
    CREATE POLICY "Project members can view task asset links"
      ON public.task_asset_links FOR SELECT
      USING (public.is_project_member(project_id));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_asset_links' AND policyname = 'Project members can create task asset links') THEN
    CREATE POLICY "Project members can create task asset links"
      ON public.task_asset_links FOR INSERT
      WITH CHECK (public.is_project_member(project_id) AND auth.uid() = created_by);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_asset_links' AND policyname = 'Link creators and admins can delete task asset links') THEN
    CREATE POLICY "Link creators and admins can delete task asset links"
      ON public.task_asset_links FOR DELETE
      USING (created_by = auth.uid() OR public.is_project_admin(project_id));
  END IF;
END$$;

-- task_doc_links policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_doc_links' AND policyname = 'Project members can view task doc links') THEN
    CREATE POLICY "Project members can view task doc links"
      ON public.task_doc_links FOR SELECT
      USING (public.is_project_member(project_id));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_doc_links' AND policyname = 'Project members can create task doc links') THEN
    CREATE POLICY "Project members can create task doc links"
      ON public.task_doc_links FOR INSERT
      WITH CHECK (public.is_project_member(project_id) AND auth.uid() = created_by);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_doc_links' AND policyname = 'Link creators and admins can delete task doc links') THEN
    CREATE POLICY "Link creators and admins can delete task doc links"
      ON public.task_doc_links FOR DELETE
      USING (created_by = auth.uid() OR public.is_project_admin(project_id));
  END IF;
END$$;

-- task_repo_links policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_repo_links' AND policyname = 'Project members can view task repo links') THEN
    CREATE POLICY "Project members can view task repo links"
      ON public.task_repo_links FOR SELECT
      USING (public.is_project_member(project_id));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_repo_links' AND policyname = 'Project members can create task repo links') THEN
    CREATE POLICY "Project members can create task repo links"
      ON public.task_repo_links FOR INSERT
      WITH CHECK (public.is_project_member(project_id) AND auth.uid() = created_by);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_repo_links' AND policyname = 'Link creators and admins can delete task repo links') THEN
    CREATE POLICY "Link creators and admins can delete task repo links"
      ON public.task_repo_links FOR DELETE
      USING (created_by = auth.uid() OR public.is_project_admin(project_id));
  END IF;
END$$;

-- task_feature_links policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_feature_links' AND policyname = 'Project members can view task feature links') THEN
    CREATE POLICY "Project members can view task feature links"
      ON public.task_feature_links FOR SELECT
      USING (public.is_project_member(project_id));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_feature_links' AND policyname = 'Project members can create task feature links') THEN
    CREATE POLICY "Project members can create task feature links"
      ON public.task_feature_links FOR INSERT
      WITH CHECK (public.is_project_member(project_id) AND auth.uid() = created_by);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_feature_links' AND policyname = 'Link creators and admins can delete task feature links') THEN
    CREATE POLICY "Link creators and admins can delete task feature links"
      ON public.task_feature_links FOR DELETE
      USING (created_by = auth.uid() OR public.is_project_admin(project_id));
  END IF;
END$$;

-- task_ticket_links policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_ticket_links' AND policyname = 'Project members can view task ticket links') THEN
    CREATE POLICY "Project members can view task ticket links"
      ON public.task_ticket_links FOR SELECT
      USING (public.is_project_member(project_id));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_ticket_links' AND policyname = 'Project members can create task ticket links') THEN
    CREATE POLICY "Project members can create task ticket links"
      ON public.task_ticket_links FOR INSERT
      WITH CHECK (public.is_project_member(project_id) AND auth.uid() = created_by);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_ticket_links' AND policyname = 'Link creators and admins can delete task ticket links') THEN
    CREATE POLICY "Link creators and admins can delete task ticket links"
      ON public.task_ticket_links FOR DELETE
      USING (created_by = auth.uid() OR public.is_project_admin(project_id));
  END IF;
END$$;

-- ===========================================
-- EXTEND task_activity_kind (safe - checks existence)
-- ===========================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'CONTEXT_LINKED'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'task_activity_kind')
  ) THEN
    ALTER TYPE task_activity_kind ADD VALUE 'CONTEXT_LINKED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'CONTEXT_UNLINKED'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'task_activity_kind')
  ) THEN
    ALTER TYPE task_activity_kind ADD VALUE 'CONTEXT_UNLINKED';
  END IF;
END$$;
