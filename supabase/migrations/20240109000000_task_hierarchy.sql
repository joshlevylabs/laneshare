-- ===========================================
-- TASK HIERARCHY SYSTEM
-- Implements 4-level hierarchy:
--   Level 1: Epic (top level, no parent)
--   Level 2: Story (parent must be Epic)
--   Level 3: Feature/Task/Bug/Spike (parent must be Story or Epic)
--   Level 4: Subtask (parent must be Feature/Task/Bug/Spike)
-- ===========================================

-- ===========================================
-- ADD NEW TASK TYPES
-- ===========================================
-- Add FEATURE type for hierarchy level 3
DO $$ BEGIN
  ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'FEATURE' AFTER 'STORY';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add SUBTASK type for hierarchy level 4
DO $$ BEGIN
  ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'SUBTASK' AFTER 'SPIKE';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================
-- ADD HIERARCHY LEVEL COLUMN
-- ===========================================
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS hierarchy_level INTEGER;

-- ===========================================
-- SET DEFAULT HIERARCHY LEVELS BASED ON TYPE
-- ===========================================
-- Update existing tasks with hierarchy levels
UPDATE public.tasks SET hierarchy_level =
  CASE
    WHEN type = 'EPIC' THEN 1
    WHEN type = 'STORY' THEN 2
    WHEN type IN ('FEATURE', 'TASK', 'BUG', 'SPIKE') THEN 3
    WHEN type = 'SUBTASK' THEN 4
    ELSE 3
  END
WHERE hierarchy_level IS NULL;

-- ===========================================
-- FUNCTION TO DETERMINE HIERARCHY LEVEL
-- ===========================================
CREATE OR REPLACE FUNCTION public.get_task_hierarchy_level(p_task_type task_type)
RETURNS INTEGER AS $$
BEGIN
  RETURN CASE
    WHEN p_task_type = 'EPIC' THEN 1
    WHEN p_task_type = 'STORY' THEN 2
    WHEN p_task_type IN ('FEATURE', 'TASK', 'BUG', 'SPIKE') THEN 3
    WHEN p_task_type = 'SUBTASK' THEN 4
    ELSE 3
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ===========================================
-- FUNCTION TO VALIDATE PARENT-CHILD HIERARCHY
-- ===========================================
CREATE OR REPLACE FUNCTION public.validate_task_hierarchy()
RETURNS TRIGGER AS $$
DECLARE
  v_parent_level INTEGER;
  v_current_level INTEGER;
BEGIN
  -- Set hierarchy level based on type
  NEW.hierarchy_level := public.get_task_hierarchy_level(NEW.type);

  -- If no parent, must be level 1, 2, or 3 (Epic, Story, or Task/Bug/Feature/Spike)
  IF NEW.parent_task_id IS NULL THEN
    -- Epics, Stories, and Level 3 items can exist without parents
    RETURN NEW;
  END IF;

  -- Get parent's hierarchy level
  SELECT hierarchy_level INTO v_parent_level
  FROM public.tasks
  WHERE id = NEW.parent_task_id;

  IF v_parent_level IS NULL THEN
    RAISE EXCEPTION 'Parent task not found';
  END IF;

  v_current_level := NEW.hierarchy_level;

  -- Validate hierarchy rules:
  -- Level 2 (Story) can be child of Level 1 (Epic)
  -- Level 3 (Feature/Task/Bug/Spike) can be child of Level 1 (Epic) or Level 2 (Story)
  -- Level 4 (Subtask) can be child of Level 3 (Feature/Task/Bug/Spike)

  IF v_current_level = 1 THEN
    -- Epics cannot have parents
    IF NEW.parent_task_id IS NOT NULL THEN
      RAISE EXCEPTION 'Epics cannot have parent tasks';
    END IF;
  ELSIF v_current_level = 2 THEN
    -- Stories can only be children of Epics
    IF v_parent_level != 1 THEN
      RAISE EXCEPTION 'Stories can only be children of Epics';
    END IF;
  ELSIF v_current_level = 3 THEN
    -- Features/Tasks/Bugs/Spikes can be children of Epics or Stories
    IF v_parent_level NOT IN (1, 2) THEN
      RAISE EXCEPTION 'Tasks/Features/Bugs can only be children of Epics or Stories';
    END IF;
  ELSIF v_current_level = 4 THEN
    -- Subtasks can only be children of Level 3 items
    IF v_parent_level != 3 THEN
      RAISE EXCEPTION 'Subtasks can only be children of Tasks/Features/Bugs/Spikes';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- CREATE HIERARCHY VALIDATION TRIGGER
-- ===========================================
DROP TRIGGER IF EXISTS validate_task_hierarchy_trigger ON public.tasks;
CREATE TRIGGER validate_task_hierarchy_trigger
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.validate_task_hierarchy();

-- ===========================================
-- ADD INDEX FOR HIERARCHY QUERIES
-- ===========================================
CREATE INDEX IF NOT EXISTS tasks_hierarchy_level_idx ON public.tasks (project_id, hierarchy_level);
CREATE INDEX IF NOT EXISTS tasks_parent_hierarchy_idx ON public.tasks (parent_task_id, hierarchy_level);

-- ===========================================
-- FUNCTION TO GET TASK ANCESTORS (full path to root)
-- ===========================================
CREATE OR REPLACE FUNCTION public.get_task_ancestors(p_task_id UUID)
RETURNS TABLE (
  id UUID,
  key TEXT,
  title TEXT,
  type task_type,
  hierarchy_level INTEGER,
  depth INTEGER
) AS $$
WITH RECURSIVE ancestors AS (
  -- Start with the given task's parent
  SELECT t.id, t.key, t.title, t.type, t.hierarchy_level, 1 AS depth
  FROM public.tasks t
  WHERE t.id = (SELECT parent_task_id FROM public.tasks WHERE id = p_task_id)

  UNION ALL

  -- Recursively get ancestors
  SELECT t.id, t.key, t.title, t.type, t.hierarchy_level, a.depth + 1
  FROM public.tasks t
  JOIN ancestors a ON t.id = (SELECT parent_task_id FROM public.tasks WHERE id = a.id)
  WHERE t.parent_task_id IS NOT NULL OR t.hierarchy_level = 1
)
SELECT * FROM ancestors ORDER BY depth DESC;
$$ LANGUAGE SQL STABLE;

-- ===========================================
-- FUNCTION TO GET TASK DESCENDANTS (all children, grandchildren, etc.)
-- ===========================================
CREATE OR REPLACE FUNCTION public.get_task_descendants(p_task_id UUID)
RETURNS TABLE (
  id UUID,
  key TEXT,
  title TEXT,
  type task_type,
  hierarchy_level INTEGER,
  depth INTEGER,
  parent_task_id UUID
) AS $$
WITH RECURSIVE descendants AS (
  -- Start with direct children
  SELECT t.id, t.key, t.title, t.type, t.hierarchy_level, 1 AS depth, t.parent_task_id
  FROM public.tasks t
  WHERE t.parent_task_id = p_task_id

  UNION ALL

  -- Recursively get descendants
  SELECT t.id, t.key, t.title, t.type, t.hierarchy_level, d.depth + 1, t.parent_task_id
  FROM public.tasks t
  JOIN descendants d ON t.parent_task_id = d.id
)
SELECT * FROM descendants ORDER BY depth, key;
$$ LANGUAGE SQL STABLE;

-- ===========================================
-- UPDATE ACTIVITY KIND FOR PARENT CHANGES
-- ===========================================
DO $$ BEGIN
  ALTER TYPE task_activity_kind ADD VALUE IF NOT EXISTS 'PARENT_CHANGED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================
-- UPDATE LOG_TASK_ACTIVITY TO INCLUDE PARENT CHANGES
-- ===========================================
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

  -- Log parent changes
  IF OLD.parent_task_id IS DISTINCT FROM NEW.parent_task_id THEN
    INSERT INTO public.task_activity (task_id, project_id, actor_id, kind, field_name, before_value, after_value)
    VALUES (NEW.id, NEW.project_id, auth.uid(), 'PARENT_CHANGED', 'parent_task_id',
            to_jsonb(OLD.parent_task_id), to_jsonb(NEW.parent_task_id));
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
