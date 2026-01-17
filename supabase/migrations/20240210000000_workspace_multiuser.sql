-- ===========================================
-- MULTI-USER WORKSPACE COLLABORATION
-- Allow multiple users to work on the same task
-- and enable Orchestrator to see all active workspaces
-- ===========================================

-- Drop the existing unique constraint (project_id, task_id)
-- This was preventing multiple users from working on the same task
ALTER TABLE workspace_sessions
  DROP CONSTRAINT IF EXISTS workspace_sessions_project_id_task_id_key;

-- Add new columns for better workspace tracking
ALTER TABLE workspace_sessions
  ADD COLUMN IF NOT EXISTS repo_id UUID REFERENCES repos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS codespace_name TEXT,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW();

COMMENT ON COLUMN workspace_sessions.repo_id IS 'Repository being worked on in this session';
COMMENT ON COLUMN workspace_sessions.codespace_name IS 'GitHub Codespace name for this session';
COMMENT ON COLUMN workspace_sessions.last_activity_at IS 'Last activity timestamp for tracking active sessions';

-- Create new unique constraint that allows per-user sessions
-- Now User A and User B can both have sessions for the same task
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_sessions_unique_per_user
  ON workspace_sessions(project_id, task_id, created_by);

-- Index for querying active sessions by project (for Orchestrator)
CREATE INDEX IF NOT EXISTS idx_workspace_sessions_active
  ON workspace_sessions(project_id, status, last_activity_at DESC)
  WHERE status = 'CONNECTED';

-- Index for repo-based queries
CREATE INDEX IF NOT EXISTS idx_workspace_sessions_repo
  ON workspace_sessions(repo_id)
  WHERE repo_id IS NOT NULL;

-- Function to update last_activity_at when messages are added
CREATE OR REPLACE FUNCTION update_session_last_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE workspace_sessions
  SET last_activity_at = NOW()
  WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update activity timestamp
DROP TRIGGER IF EXISTS update_session_activity_on_message ON workspace_messages;
CREATE TRIGGER update_session_activity_on_message
  AFTER INSERT ON workspace_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_session_last_activity();

-- Update RLS policy for delete - allow admins to delete any session in their project
DROP POLICY IF EXISTS "Users can delete their own workspace sessions" ON workspace_sessions;
CREATE POLICY "Users can delete workspace sessions they own or as admin"
  ON workspace_sessions FOR DELETE
  USING (
    created_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_id = workspace_sessions.project_id
      AND user_id = auth.uid()
      AND role IN ('OWNER', 'MAINTAINER')
    )
  );
