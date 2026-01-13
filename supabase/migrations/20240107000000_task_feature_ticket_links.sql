-- ===========================================
-- TASK FEATURE & TICKET LINKS
-- Additional context link tables for architecture features and related tickets
-- ===========================================

-- ===========================================
-- TASK-TO-FEATURE LINKS
-- Links tasks to architecture features
-- ===========================================

CREATE TABLE public.task_feature_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  feature_id UUID NOT NULL REFERENCES public.architecture_features(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, feature_id)
);

CREATE INDEX task_feature_links_task_idx ON public.task_feature_links (task_id);
CREATE INDEX task_feature_links_feature_idx ON public.task_feature_links (feature_id);
CREATE INDEX task_feature_links_project_idx ON public.task_feature_links (project_id);

-- ===========================================
-- TASK-TO-TICKET LINKS
-- Links tasks to other related tasks/tickets
-- ===========================================

CREATE TABLE public.task_ticket_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  linked_task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL DEFAULT 'related' CHECK (link_type IN ('related', 'blocks', 'blocked_by', 'duplicates', 'duplicated_by')),
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, linked_task_id),
  CHECK (task_id != linked_task_id)  -- Prevent self-linking
);

CREATE INDEX task_ticket_links_task_idx ON public.task_ticket_links (task_id);
CREATE INDEX task_ticket_links_linked_task_idx ON public.task_ticket_links (linked_task_id);
CREATE INDEX task_ticket_links_project_idx ON public.task_ticket_links (project_id);

-- ===========================================
-- ROW LEVEL SECURITY
-- ===========================================

ALTER TABLE public.task_feature_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_ticket_links ENABLE ROW LEVEL SECURITY;

-- ===========================================
-- RLS POLICIES FOR task_feature_links
-- ===========================================

CREATE POLICY "Project members can view task feature links"
  ON public.task_feature_links FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create task feature links"
  ON public.task_feature_links FOR INSERT
  WITH CHECK (public.is_project_member(project_id) AND auth.uid() = created_by);

CREATE POLICY "Link creators and admins can delete task feature links"
  ON public.task_feature_links FOR DELETE
  USING (
    created_by = auth.uid() OR
    public.is_project_admin(project_id)
  );

-- ===========================================
-- RLS POLICIES FOR task_ticket_links
-- ===========================================

CREATE POLICY "Project members can view task ticket links"
  ON public.task_ticket_links FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create task ticket links"
  ON public.task_ticket_links FOR INSERT
  WITH CHECK (public.is_project_member(project_id) AND auth.uid() = created_by);

CREATE POLICY "Link creators and admins can delete task ticket links"
  ON public.task_ticket_links FOR DELETE
  USING (
    created_by = auth.uid() OR
    public.is_project_admin(project_id)
  );
