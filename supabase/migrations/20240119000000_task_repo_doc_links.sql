-- Migration: Add task_repo_doc_links table
-- Links tasks to generated repository documentation pages

CREATE TABLE IF NOT EXISTS public.task_repo_doc_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  repo_doc_page_id UUID NOT NULL REFERENCES public.repo_doc_pages(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(task_id, repo_doc_page_id)
);

-- Create indexes
CREATE INDEX idx_task_repo_doc_links_task_id ON public.task_repo_doc_links(task_id);
CREATE INDEX idx_task_repo_doc_links_page_id ON public.task_repo_doc_links(repo_doc_page_id);
CREATE INDEX idx_task_repo_doc_links_project_id ON public.task_repo_doc_links(project_id);

-- Enable RLS
ALTER TABLE public.task_repo_doc_links ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Project members can view task repo doc links"
  ON public.task_repo_doc_links FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = task_repo_doc_links.project_id
      AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Project members can create task repo doc links"
  ON public.task_repo_doc_links FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = task_repo_doc_links.project_id
      AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Project members can delete task repo doc links"
  ON public.task_repo_doc_links FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = task_repo_doc_links.project_id
      AND pm.user_id = auth.uid()
    )
  );

-- Service role full access
CREATE POLICY "Service role full access to task repo doc links"
  ON public.task_repo_doc_links FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.task_repo_doc_links IS 'Links tasks to auto-generated repository documentation pages';
