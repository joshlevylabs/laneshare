-- ===========================================
-- TASK TRACKER ENHANCEMENTS
-- Jira-like task tracking capabilities
-- ===========================================

-- ===========================================
-- TASK TYPE ENUM
-- ===========================================
CREATE TYPE task_type AS ENUM ('EPIC', 'STORY', 'TASK', 'BUG', 'SPIKE');

-- ===========================================
-- SPRINT STATUS ENUM
-- ===========================================
CREATE TYPE sprint_status AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED');

-- ===========================================
-- TASK ACTIVITY KIND ENUM
-- ===========================================
CREATE TYPE task_activity_kind AS ENUM (
  'CREATED',
  'UPDATED',
  'STATUS_CHANGED',
  'MOVED_SPRINT',
  'ASSIGNED',
  'COMMENTED',
  'PRIORITY_CHANGED',
  'TYPE_CHANGED'
);

-- ===========================================
-- UPDATE TASK_STATUS ENUM (add IN_REVIEW)
-- ===========================================
-- PostgreSQL doesn't allow direct ALTER TYPE for enums,
-- so we add the new value
ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'IN_REVIEW' AFTER 'IN_PROGRESS';

-- ===========================================
-- PROJECT COUNTERS (for task key generation)
-- ===========================================
CREATE TABLE public.project_counters (
  project_id UUID PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  task_counter INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.project_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view counters"
  ON public.project_counters FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can update counters"
  ON public.project_counters FOR UPDATE
  USING (public.is_project_member(project_id));

-- ===========================================
-- UPDATE PROJECTS TABLE (add task_key_prefix)
-- ===========================================
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS task_key_prefix TEXT DEFAULT 'LS';

-- ===========================================
-- UPDATE SPRINTS TABLE
-- ===========================================
ALTER TABLE public.sprints
  ADD COLUMN IF NOT EXISTS goal TEXT,
  ADD COLUMN IF NOT EXISTS status sprint_status DEFAULT 'PLANNED';

-- Update existing sprints to have PLANNED status
UPDATE public.sprints SET status = 'PLANNED' WHERE status IS NULL;

-- ===========================================
-- UPDATE TASKS TABLE
-- ===========================================
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS key TEXT,
  ADD COLUMN IF NOT EXISTS type task_type DEFAULT 'TASK',
  ADD COLUMN IF NOT EXISTS labels TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS story_points INTEGER,
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS reporter_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rank FLOAT8 DEFAULT 0;

-- Create index for task key lookups
CREATE INDEX IF NOT EXISTS tasks_key_idx ON public.tasks (project_id, key);

-- Create index for parent task lookups (subtasks)
CREATE INDEX IF NOT EXISTS tasks_parent_idx ON public.tasks (parent_task_id);

-- Create index for sprint + status (for board views)
CREATE INDEX IF NOT EXISTS tasks_sprint_status_idx ON public.tasks (sprint_id, status);

-- Create index for rank ordering
CREATE INDEX IF NOT EXISTS tasks_rank_idx ON public.tasks (project_id, rank);

-- Create index for labels (GIN for array contains queries)
CREATE INDEX IF NOT EXISTS tasks_labels_idx ON public.tasks USING GIN (labels);

-- ===========================================
-- TASK COMMENTS
-- ===========================================
CREATE TABLE public.task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX task_comments_task_idx ON public.task_comments (task_id, created_at);

ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view task comments"
  ON public.task_comments FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create task comments"
  ON public.task_comments FOR INSERT
  WITH CHECK (public.is_project_member(project_id) AND auth.uid() = author_id);

CREATE POLICY "Comment authors can update their comments"
  ON public.task_comments FOR UPDATE
  USING (auth.uid() = author_id);

CREATE POLICY "Comment authors can delete their comments"
  ON public.task_comments FOR DELETE
  USING (auth.uid() = author_id);

-- ===========================================
-- TASK ACTIVITY (audit trail)
-- ===========================================
CREATE TABLE public.task_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind task_activity_kind NOT NULL,
  field_name TEXT, -- which field changed (for UPDATED)
  before_value JSONB,
  after_value JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX task_activity_task_idx ON public.task_activity (task_id, created_at DESC);

ALTER TABLE public.task_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view task activity"
  ON public.task_activity FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create task activity"
  ON public.task_activity FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

-- ===========================================
-- HELPER FUNCTIONS
-- ===========================================

-- Function to get next task key for a project
CREATE OR REPLACE FUNCTION public.get_next_task_key(p_project_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_prefix TEXT;
  v_counter INTEGER;
BEGIN
  -- Get or create counter for project
  INSERT INTO public.project_counters (project_id, task_counter)
  VALUES (p_project_id, 0)
  ON CONFLICT (project_id) DO NOTHING;

  -- Increment and get counter
  UPDATE public.project_counters
  SET task_counter = task_counter + 1
  WHERE project_id = p_project_id
  RETURNING task_counter INTO v_counter;

  -- Get project prefix
  SELECT COALESCE(task_key_prefix, 'LS') INTO v_prefix
  FROM public.projects
  WHERE id = p_project_id;

  RETURN v_prefix || '-' || v_counter;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to auto-assign task key on insert
CREATE OR REPLACE FUNCTION public.assign_task_key()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.key IS NULL OR NEW.key = '' THEN
    NEW.key := public.get_next_task_key(NEW.project_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-assign task key
DROP TRIGGER IF EXISTS assign_task_key_trigger ON public.tasks;
CREATE TRIGGER assign_task_key_trigger
  BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.assign_task_key();

-- Function to calculate rank for new tasks (insert at end of list)
CREATE OR REPLACE FUNCTION public.calculate_task_rank()
RETURNS TRIGGER AS $$
DECLARE
  v_max_rank FLOAT8;
BEGIN
  IF NEW.rank IS NULL OR NEW.rank = 0 THEN
    SELECT COALESCE(MAX(rank), 0) + 1000 INTO v_max_rank
    FROM public.tasks
    WHERE project_id = NEW.project_id
      AND COALESCE(sprint_id, '00000000-0000-0000-0000-000000000000') =
          COALESCE(NEW.sprint_id, '00000000-0000-0000-0000-000000000000')
      AND status = NEW.status;

    NEW.rank := v_max_rank;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to calculate rank
DROP TRIGGER IF EXISTS calculate_task_rank_trigger ON public.tasks;
CREATE TRIGGER calculate_task_rank_trigger
  BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.calculate_task_rank();

-- Function to log task activity
CREATE OR REPLACE FUNCTION public.log_task_activity()
RETURNS TRIGGER AS $$
BEGIN
  -- Log status changes
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.task_activity (task_id, project_id, actor_id, kind, field_name, before_value, after_value)
    VALUES (NEW.id, NEW.project_id, auth.uid(), 'STATUS_CHANGED', 'status',
            to_jsonb(OLD.status), to_jsonb(NEW.status));
  END IF;

  -- Log assignee changes
  IF OLD.assignee_id IS DISTINCT FROM NEW.assignee_id THEN
    INSERT INTO public.task_activity (task_id, project_id, actor_id, kind, field_name, before_value, after_value)
    VALUES (NEW.id, NEW.project_id, auth.uid(), 'ASSIGNED', 'assignee_id',
            to_jsonb(OLD.assignee_id), to_jsonb(NEW.assignee_id));
  END IF;

  -- Log sprint changes
  IF OLD.sprint_id IS DISTINCT FROM NEW.sprint_id THEN
    INSERT INTO public.task_activity (task_id, project_id, actor_id, kind, field_name, before_value, after_value)
    VALUES (NEW.id, NEW.project_id, auth.uid(), 'MOVED_SPRINT', 'sprint_id',
            to_jsonb(OLD.sprint_id), to_jsonb(NEW.sprint_id));
  END IF;

  -- Log priority changes
  IF OLD.priority IS DISTINCT FROM NEW.priority THEN
    INSERT INTO public.task_activity (task_id, project_id, actor_id, kind, field_name, before_value, after_value)
    VALUES (NEW.id, NEW.project_id, auth.uid(), 'PRIORITY_CHANGED', 'priority',
            to_jsonb(OLD.priority), to_jsonb(NEW.priority));
  END IF;

  -- Log type changes
  IF OLD.type IS DISTINCT FROM NEW.type THEN
    INSERT INTO public.task_activity (task_id, project_id, actor_id, kind, field_name, before_value, after_value)
    VALUES (NEW.id, NEW.project_id, auth.uid(), 'TYPE_CHANGED', 'type',
            to_jsonb(OLD.type), to_jsonb(NEW.type));
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to log task activity on updates
DROP TRIGGER IF EXISTS log_task_activity_trigger ON public.tasks;
CREATE TRIGGER log_task_activity_trigger
  AFTER UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.log_task_activity();

-- Function to log task creation
CREATE OR REPLACE FUNCTION public.log_task_creation()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.task_activity (task_id, project_id, actor_id, kind)
  VALUES (NEW.id, NEW.project_id, COALESCE(NEW.reporter_id, auth.uid()), 'CREATED');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to log task creation
DROP TRIGGER IF EXISTS log_task_creation_trigger ON public.tasks;
CREATE TRIGGER log_task_creation_trigger
  AFTER INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.log_task_creation();

-- Update trigger for task_comments updated_at
CREATE TRIGGER update_task_comments_updated_at
  BEFORE UPDATE ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ===========================================
-- GENERATE KEYS FOR EXISTING TASKS
-- ===========================================
-- Generate keys for any existing tasks that don't have one
DO $$
DECLARE
  r RECORD;
  v_key TEXT;
BEGIN
  FOR r IN
    SELECT id, project_id
    FROM public.tasks
    WHERE key IS NULL OR key = ''
    ORDER BY created_at
  LOOP
    v_key := public.get_next_task_key(r.project_id);
    UPDATE public.tasks SET key = v_key WHERE id = r.id;
  END LOOP;
END $$;

-- Make key NOT NULL now that all existing tasks have keys
ALTER TABLE public.tasks ALTER COLUMN key SET NOT NULL;

-- Add unique constraint for keys within a project
ALTER TABLE public.tasks ADD CONSTRAINT tasks_key_unique UNIQUE (project_id, key);
