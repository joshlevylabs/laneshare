-- Migration: PRD Management System
-- Enables PRD creation, planning chat, and sprint generation using Ralph-compatible format

-- =============================================
-- PRD Documents Table
-- =============================================
CREATE TABLE IF NOT EXISTS public.project_prds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,

  -- PRD content
  raw_markdown TEXT, -- Original PRD text (pasted or generated from chat)
  prd_json JSONB, -- Converted Ralph-compatible JSON structure

  -- Status tracking
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PLANNING', 'READY', 'PROCESSING', 'COMPLETED')),

  -- Metadata
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Version tracking for iterative refinement
  version INT NOT NULL DEFAULT 1
);

-- Indexes
CREATE INDEX idx_project_prds_project_id ON public.project_prds(project_id);
CREATE INDEX idx_project_prds_status ON public.project_prds(status);
CREATE INDEX idx_project_prds_created_at ON public.project_prds(created_at DESC);

-- =============================================
-- PRD Chat Messages (for Plan mode)
-- =============================================
CREATE TABLE IF NOT EXISTS public.prd_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prd_id UUID NOT NULL REFERENCES public.project_prds(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  sender VARCHAR(10) NOT NULL CHECK (sender IN ('USER', 'AI')),
  content TEXT NOT NULL,

  -- AI can suggest PRD sections
  suggested_section JSONB, -- { type: 'user_story' | 'description' | 'criteria', content: ... }

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_prd_chat_messages_prd_id ON public.prd_chat_messages(prd_id);
CREATE INDEX idx_prd_chat_messages_created_at ON public.prd_chat_messages(created_at);

-- =============================================
-- PRD Sprints (tracks generated sprints)
-- =============================================
CREATE TABLE IF NOT EXISTS public.prd_sprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prd_id UUID NOT NULL REFERENCES public.project_prds(id) ON DELETE CASCADE,
  sprint_id UUID NOT NULL REFERENCES public.sprints(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  -- Track which user stories are in this sprint
  user_story_ids TEXT[] NOT NULL DEFAULT '{}',

  -- Implementation status
  implementation_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (implementation_status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED')),
  implementation_started_at TIMESTAMPTZ,
  implementation_completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(prd_id, sprint_id)
);

-- Indexes
CREATE INDEX idx_prd_sprints_prd_id ON public.prd_sprints(prd_id);
CREATE INDEX idx_prd_sprints_sprint_id ON public.prd_sprints(sprint_id);

-- =============================================
-- PRD User Story to Task Mapping
-- =============================================
CREATE TABLE IF NOT EXISTS public.prd_story_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prd_id UUID NOT NULL REFERENCES public.project_prds(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_story_id VARCHAR(20) NOT NULL, -- US-001, US-002, etc.
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,

  -- Track completion based on task status
  passes BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(prd_id, user_story_id)
);

-- Indexes
CREATE INDEX idx_prd_story_tasks_prd_id ON public.prd_story_tasks(prd_id);
CREATE INDEX idx_prd_story_tasks_task_id ON public.prd_story_tasks(task_id);

-- =============================================
-- RLS Policies
-- =============================================

-- Enable RLS
ALTER TABLE public.project_prds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prd_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prd_sprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prd_story_tasks ENABLE ROW LEVEL SECURITY;

-- project_prds policies
CREATE POLICY "Project members can view PRDs"
  ON public.project_prds FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_prds.project_id
      AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Project members can create PRDs"
  ON public.project_prds FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_prds.project_id
      AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Project members can update PRDs"
  ON public.project_prds FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_prds.project_id
      AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Project members can delete PRDs"
  ON public.project_prds FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = project_prds.project_id
      AND pm.user_id = auth.uid()
    )
  );

-- prd_chat_messages policies
CREATE POLICY "Project members can view PRD chat"
  ON public.prd_chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = prd_chat_messages.project_id
      AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Project members can create PRD chat messages"
  ON public.prd_chat_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = prd_chat_messages.project_id
      AND pm.user_id = auth.uid()
    )
  );

-- prd_sprints policies
CREATE POLICY "Project members can view PRD sprints"
  ON public.prd_sprints FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = prd_sprints.project_id
      AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Project members can create PRD sprints"
  ON public.prd_sprints FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = prd_sprints.project_id
      AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Project members can update PRD sprints"
  ON public.prd_sprints FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = prd_sprints.project_id
      AND pm.user_id = auth.uid()
    )
  );

-- prd_story_tasks policies
CREATE POLICY "Project members can view PRD story tasks"
  ON public.prd_story_tasks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = prd_story_tasks.project_id
      AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Project members can manage PRD story tasks"
  ON public.prd_story_tasks FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = prd_story_tasks.project_id
      AND pm.user_id = auth.uid()
    )
  );

-- Service role full access
CREATE POLICY "Service role full access to project_prds"
  ON public.project_prds FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to prd_chat_messages"
  ON public.prd_chat_messages FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to prd_sprints"
  ON public.prd_sprints FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to prd_story_tasks"
  ON public.prd_story_tasks FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- =============================================
-- Triggers
-- =============================================

-- Update updated_at on project_prds
CREATE OR REPLACE FUNCTION update_prd_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_prd_updated_at
  BEFORE UPDATE ON public.project_prds
  FOR EACH ROW
  EXECUTE FUNCTION update_prd_updated_at();

-- Update prd_story_tasks.passes when task status changes to DONE
CREATE OR REPLACE FUNCTION sync_prd_story_task_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'DONE' AND OLD.status != 'DONE' THEN
    UPDATE public.prd_story_tasks
    SET passes = true, updated_at = now()
    WHERE task_id = NEW.id;
  ELSIF NEW.status != 'DONE' AND OLD.status = 'DONE' THEN
    UPDATE public.prd_story_tasks
    SET passes = false, updated_at = now()
    WHERE task_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_sync_prd_story_task_status
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION sync_prd_story_task_status();

-- Comments
COMMENT ON TABLE public.project_prds IS 'Product Requirement Documents for project planning';
COMMENT ON TABLE public.prd_chat_messages IS 'Chat history for PRD plan mode';
COMMENT ON TABLE public.prd_sprints IS 'Tracks sprints generated from PRD user stories';
COMMENT ON TABLE public.prd_story_tasks IS 'Maps PRD user stories to generated tasks';
