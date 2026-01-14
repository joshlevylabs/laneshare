-- Workspace sessions table for Claude Code integration
CREATE TABLE workspace_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  local_session_id TEXT,  -- Claude Code session ID from local server
  status TEXT NOT NULL DEFAULT 'DISCONNECTED' CHECK (status IN ('CONNECTING', 'CONNECTED', 'DISCONNECTED', 'ERROR')),
  connection_config JSONB DEFAULT '{}',
  error_message TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, task_id)  -- One session per task per project
);

-- Workspace messages table (cache of messages from local server)
CREATE TABLE workspace_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES workspace_sessions(id) ON DELETE CASCADE,
  local_message_id TEXT,  -- ID from Claude Code
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool_use', 'tool_result', 'system')),
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_input JSONB,
  tool_result TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_workspace_sessions_project ON workspace_sessions(project_id);
CREATE INDEX idx_workspace_sessions_task ON workspace_sessions(task_id);
CREATE INDEX idx_workspace_sessions_created_by ON workspace_sessions(created_by);
CREATE INDEX idx_workspace_messages_session ON workspace_messages(session_id);
CREATE INDEX idx_workspace_messages_timestamp ON workspace_messages(session_id, timestamp);

-- Update timestamp trigger for workspace_sessions
CREATE TRIGGER update_workspace_sessions_updated_at
  BEFORE UPDATE ON workspace_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS Policies
ALTER TABLE workspace_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_messages ENABLE ROW LEVEL SECURITY;

-- Workspace sessions policies
CREATE POLICY "Users can view workspace sessions in their projects"
  ON workspace_sessions FOR SELECT
  USING (project_id IN (
    SELECT project_id FROM project_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can create workspace sessions in their projects"
  ON workspace_sessions FOR INSERT
  WITH CHECK (project_id IN (
    SELECT project_id FROM project_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can update workspace sessions in their projects"
  ON workspace_sessions FOR UPDATE
  USING (project_id IN (
    SELECT project_id FROM project_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can delete their own workspace sessions"
  ON workspace_sessions FOR DELETE
  USING (created_by = auth.uid());

-- Workspace messages policies
CREATE POLICY "Users can view workspace messages in their projects"
  ON workspace_messages FOR SELECT
  USING (session_id IN (
    SELECT id FROM workspace_sessions WHERE project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  ));

CREATE POLICY "Users can create workspace messages in their sessions"
  ON workspace_messages FOR INSERT
  WITH CHECK (session_id IN (
    SELECT id FROM workspace_sessions WHERE project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  ));

CREATE POLICY "Users can delete workspace messages in their projects"
  ON workspace_messages FOR DELETE
  USING (session_id IN (
    SELECT id FROM workspace_sessions WHERE project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  ));
