-- ===========================================
-- WORKSPACE SESSIONS: MAKE TASK_ID OPTIONAL
-- Support codespace-based sessions without a task
-- ===========================================

-- Make task_id optional to support codespace-only sessions
ALTER TABLE workspace_sessions
  ALTER COLUMN task_id DROP NOT NULL;

-- Update the unique constraint to handle NULL task_id
-- Drop the existing index first
DROP INDEX IF EXISTS idx_workspace_sessions_unique_per_user;

-- Create new unique constraint that handles NULL task_id
-- User can have one session per (project, repo, codespace) combo
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_sessions_unique_per_user
  ON workspace_sessions(project_id, COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid), created_by);

-- Alternative unique index for codespace-based sessions
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_sessions_unique_codespace
  ON workspace_sessions(project_id, codespace_name, created_by)
  WHERE codespace_name IS NOT NULL;

COMMENT ON COLUMN workspace_sessions.task_id IS 'Optional task being worked on - NULL for ad-hoc codespace sessions';
