-- ===========================================
-- TASK CONTEXT LINKS FEATURE
-- Links tasks to services, assets, repos, and docs
-- ===========================================

-- ===========================================
-- TASK-TO-SERVICE LINKS
-- Links tasks to project service connections
-- ===========================================

CREATE TABLE public.task_service_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.project_service_connections(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, connection_id)
);

CREATE INDEX task_service_links_task_idx ON public.task_service_links (task_id);
CREATE INDEX task_service_links_connection_idx ON public.task_service_links (connection_id);
CREATE INDEX task_service_links_project_idx ON public.task_service_links (project_id);

-- ===========================================
-- TASK-TO-ASSET LINKS
-- Links tasks to specific service assets (tables, functions, etc.)
-- ===========================================

CREATE TABLE public.task_asset_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.service_assets(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, asset_id)
);

CREATE INDEX task_asset_links_task_idx ON public.task_asset_links (task_id);
CREATE INDEX task_asset_links_asset_idx ON public.task_asset_links (asset_id);
CREATE INDEX task_asset_links_project_idx ON public.task_asset_links (project_id);

-- ===========================================
-- TASK-TO-DOC LINKS
-- Links tasks to documentation pages
-- ===========================================

CREATE TABLE public.task_doc_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  doc_id UUID NOT NULL REFERENCES public.doc_pages(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, doc_id)
);

CREATE INDEX task_doc_links_task_idx ON public.task_doc_links (task_id);
CREATE INDEX task_doc_links_doc_idx ON public.task_doc_links (doc_id);
CREATE INDEX task_doc_links_project_idx ON public.task_doc_links (project_id);

-- ===========================================
-- TASK-TO-REPO LINKS
-- Links tasks to repositories (replaces repo_scope array approach)
-- ===========================================

CREATE TABLE public.task_repo_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, repo_id)
);

CREATE INDEX task_repo_links_task_idx ON public.task_repo_links (task_id);
CREATE INDEX task_repo_links_repo_idx ON public.task_repo_links (repo_id);
CREATE INDEX task_repo_links_project_idx ON public.task_repo_links (project_id);

-- ===========================================
-- CONTEXT AI MESSAGES
-- Stores chat history for the Context AI assistant
-- ===========================================

CREATE TABLE public.task_context_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('USER', 'AI')),
  content TEXT NOT NULL,
  suggestions JSONB DEFAULT '[]',  -- Array of ContextAISuggestion objects
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX task_context_messages_task_idx ON public.task_context_messages (task_id, created_at);
CREATE INDEX task_context_messages_project_idx ON public.task_context_messages (project_id);

-- ===========================================
-- ROW LEVEL SECURITY
-- ===========================================

ALTER TABLE public.task_service_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_asset_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_doc_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_repo_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_context_messages ENABLE ROW LEVEL SECURITY;

-- ===========================================
-- RLS POLICIES FOR task_service_links
-- ===========================================

CREATE POLICY "Project members can view task service links"
  ON public.task_service_links FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create task service links"
  ON public.task_service_links FOR INSERT
  WITH CHECK (public.is_project_member(project_id) AND auth.uid() = created_by);

CREATE POLICY "Link creators and admins can delete task service links"
  ON public.task_service_links FOR DELETE
  USING (
    created_by = auth.uid() OR
    public.is_project_admin(project_id)
  );

-- ===========================================
-- RLS POLICIES FOR task_asset_links
-- ===========================================

CREATE POLICY "Project members can view task asset links"
  ON public.task_asset_links FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create task asset links"
  ON public.task_asset_links FOR INSERT
  WITH CHECK (public.is_project_member(project_id) AND auth.uid() = created_by);

CREATE POLICY "Link creators and admins can delete task asset links"
  ON public.task_asset_links FOR DELETE
  USING (
    created_by = auth.uid() OR
    public.is_project_admin(project_id)
  );

-- ===========================================
-- RLS POLICIES FOR task_doc_links
-- ===========================================

CREATE POLICY "Project members can view task doc links"
  ON public.task_doc_links FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create task doc links"
  ON public.task_doc_links FOR INSERT
  WITH CHECK (public.is_project_member(project_id) AND auth.uid() = created_by);

CREATE POLICY "Link creators and admins can delete task doc links"
  ON public.task_doc_links FOR DELETE
  USING (
    created_by = auth.uid() OR
    public.is_project_admin(project_id)
  );

-- ===========================================
-- RLS POLICIES FOR task_repo_links
-- ===========================================

CREATE POLICY "Project members can view task repo links"
  ON public.task_repo_links FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create task repo links"
  ON public.task_repo_links FOR INSERT
  WITH CHECK (public.is_project_member(project_id) AND auth.uid() = created_by);

CREATE POLICY "Link creators and admins can delete task repo links"
  ON public.task_repo_links FOR DELETE
  USING (
    created_by = auth.uid() OR
    public.is_project_admin(project_id)
  );

-- ===========================================
-- RLS POLICIES FOR task_context_messages
-- ===========================================

CREATE POLICY "Project members can view task context messages"
  ON public.task_context_messages FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create task context messages"
  ON public.task_context_messages FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY "Message creators and admins can delete task context messages"
  ON public.task_context_messages FOR DELETE
  USING (
    created_by = auth.uid() OR
    public.is_project_admin(project_id)
  );

-- ===========================================
-- EXTEND task_activity_kind FOR CONTEXT EVENTS
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
