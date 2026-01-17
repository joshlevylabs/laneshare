-- ===========================================
-- ORCHESTRATOR EVENTS & CROSS-SESSION COMMUNICATION
-- Enable real-time file tracking, push notifications,
-- and cross-session communication for the orchestrator
-- ===========================================

-- ============================================
-- PHASE 1: FILE ACTIVITY TRACKING
-- ============================================

-- File activity log for real-time tracking
CREATE TABLE IF NOT EXISTS workspace_file_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES workspace_sessions(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('read', 'write', 'create', 'delete', 'rename')),
  file_path TEXT NOT NULL,
  file_hash TEXT,                    -- SHA256 of file content for conflict detection
  lines_changed INTEGER,             -- Number of lines modified
  change_summary TEXT,               -- Brief description of changes
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 hour'  -- Auto-cleanup old entries
);

-- Index for fast lookups by session
CREATE INDEX IF NOT EXISTS idx_file_activity_session
  ON workspace_file_activity(session_id, timestamp DESC);

-- Index for finding conflicts (same file, different sessions)
CREATE INDEX IF NOT EXISTS idx_file_activity_file
  ON workspace_file_activity(file_path, timestamp DESC);

-- Composite index for conflict detection queries
CREATE INDEX IF NOT EXISTS idx_file_activity_conflicts
  ON workspace_file_activity(file_path, session_id, activity_type);

-- RLS for file activity
ALTER TABLE workspace_file_activity ENABLE ROW LEVEL SECURITY;

-- Users can view file activity for sessions in their projects
CREATE POLICY "Users can view file activity in their projects"
  ON workspace_file_activity FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_sessions ws
      JOIN project_members pm ON pm.project_id = ws.project_id
      WHERE ws.id = workspace_file_activity.session_id
      AND pm.user_id = auth.uid()
    )
  );

-- Users can insert file activity for their own sessions
CREATE POLICY "Users can insert file activity for their sessions"
  ON workspace_file_activity FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_sessions ws
      WHERE ws.id = workspace_file_activity.session_id
      AND ws.created_by = auth.uid()
    )
  );

-- ============================================
-- PHASE 2: PUSH NOTIFICATIONS (EVENT QUEUE)
-- ============================================

-- Store pending events for sessions that might reconnect
CREATE TABLE IF NOT EXISTS workspace_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_session_id UUID REFERENCES workspace_sessions(id) ON DELETE CASCADE,
  target_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'file_conflict',
    'session_joined',
    'session_left',
    'orchestrator_message',
    'cross_session_request',
    'cross_session_response',
    'sync_required'
  )),
  event_data JSONB NOT NULL,
  delivered BOOLEAN DEFAULT false,
  acknowledged BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 hour'
);

-- Index for fetching pending events
CREATE INDEX IF NOT EXISTS idx_workspace_events_pending
  ON workspace_events(target_session_id, delivered, created_at)
  WHERE delivered = false;

-- Index for user-level events
CREATE INDEX IF NOT EXISTS idx_workspace_events_user
  ON workspace_events(target_user_id, delivered, created_at)
  WHERE delivered = false;

-- RLS for events
ALTER TABLE workspace_events ENABLE ROW LEVEL SECURITY;

-- Users can view events targeted at them or their sessions
CREATE POLICY "Users can view their events"
  ON workspace_events FOR SELECT
  USING (
    target_user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM workspace_sessions ws
      WHERE ws.id = workspace_events.target_session_id
      AND ws.created_by = auth.uid()
    ) OR
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = workspace_events.project_id
      AND pm.user_id = auth.uid()
    )
  );

-- System can insert events (via service role)
CREATE POLICY "System can insert events"
  ON workspace_events FOR INSERT
  WITH CHECK (true);

-- Users can update events they've received (mark as delivered/acknowledged)
CREATE POLICY "Users can update their events"
  ON workspace_events FOR UPDATE
  USING (
    target_user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM workspace_sessions ws
      WHERE ws.id = workspace_events.target_session_id
      AND ws.created_by = auth.uid()
    )
  );

-- ============================================
-- PHASE 3: CROSS-SESSION COMMUNICATION
-- ============================================

-- Cross-session message queue
CREATE TABLE IF NOT EXISTS workspace_cross_session_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Request details
  request_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  source_session_id UUID NOT NULL REFERENCES workspace_sessions(id) ON DELETE CASCADE,
  target_session_id UUID REFERENCES workspace_sessions(id) ON DELETE SET NULL,
  target_repo_id UUID REFERENCES repos(id) ON DELETE SET NULL,

  -- Message content
  message_type TEXT NOT NULL CHECK (message_type IN ('query', 'command', 'sync')),
  query TEXT NOT NULL,
  context JSONB,  -- Additional context for the request

  -- Response
  response TEXT,
  response_data JSONB,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'processing', 'completed', 'failed', 'timeout')),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '5 minutes'
);

-- Index for finding pending requests for a target session
CREATE INDEX IF NOT EXISTS idx_cross_session_pending
  ON workspace_cross_session_messages(target_session_id, status, created_at)
  WHERE status IN ('pending', 'delivered');

-- Index for source session to check their requests
CREATE INDEX IF NOT EXISTS idx_cross_session_source
  ON workspace_cross_session_messages(source_session_id, status, created_at);

-- Index for finding requests by repo
CREATE INDEX IF NOT EXISTS idx_cross_session_repo
  ON workspace_cross_session_messages(target_repo_id, status)
  WHERE target_repo_id IS NOT NULL;

-- RLS for cross-session messages
ALTER TABLE workspace_cross_session_messages ENABLE ROW LEVEL SECURITY;

-- Users can view messages they sent or received
CREATE POLICY "Users can view their cross-session messages"
  ON workspace_cross_session_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_sessions ws
      WHERE (ws.id = workspace_cross_session_messages.source_session_id
             OR ws.id = workspace_cross_session_messages.target_session_id)
      AND ws.created_by = auth.uid()
    )
  );

-- Users can create requests from their sessions
CREATE POLICY "Users can create cross-session requests"
  ON workspace_cross_session_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_sessions ws
      WHERE ws.id = workspace_cross_session_messages.source_session_id
      AND ws.created_by = auth.uid()
    )
  );

-- Users can update messages targeted at their sessions (to respond)
CREATE POLICY "Users can respond to cross-session requests"
  ON workspace_cross_session_messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM workspace_sessions ws
      WHERE ws.id = workspace_cross_session_messages.target_session_id
      AND ws.created_by = auth.uid()
    )
  );

-- ============================================
-- CLEANUP FUNCTIONS
-- ============================================

-- Function to clean up expired file activity
CREATE OR REPLACE FUNCTION cleanup_expired_file_activity()
RETURNS void AS $$
BEGIN
  DELETE FROM workspace_file_activity WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to clean up expired events
CREATE OR REPLACE FUNCTION cleanup_expired_events()
RETURNS void AS $$
BEGIN
  DELETE FROM workspace_events WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to timeout expired cross-session messages
CREATE OR REPLACE FUNCTION timeout_expired_cross_session_messages()
RETURNS void AS $$
BEGIN
  UPDATE workspace_cross_session_messages
  SET status = 'timeout', completed_at = NOW()
  WHERE expires_at < NOW() AND status IN ('pending', 'delivered', 'processing');
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Drop ALL overloads of these functions to avoid signature conflicts
DO $$
DECLARE
  func_record RECORD;
BEGIN
  -- Drop all detect_file_conflicts functions
  FOR func_record IN
    SELECT oid::regprocedure as func_signature
    FROM pg_proc
    WHERE proname = 'detect_file_conflicts'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || func_record.func_signature || ' CASCADE';
  END LOOP;

  -- Drop all find_session_for_repo functions
  FOR func_record IN
    SELECT oid::regprocedure as func_signature
    FROM pg_proc
    WHERE proname = 'find_session_for_repo'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || func_record.func_signature || ' CASCADE';
  END LOOP;
END $$;

-- Function to detect file conflicts
CREATE OR REPLACE FUNCTION detect_file_conflicts(
  p_session_id UUID,
  p_file_path TEXT
)
RETURNS TABLE (
  conflicting_session_id UUID,
  conflicting_user_id UUID,
  conflicting_user_name TEXT,
  last_activity_type TEXT,
  last_activity_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (ws.id)
    ws.id as conflicting_session_id,
    ws.created_by as conflicting_user_id,
    COALESCE(p.full_name, p.email) as conflicting_user_name,
    fa.activity_type as last_activity_type,
    fa.timestamp as last_activity_at
  FROM workspace_file_activity fa
  JOIN workspace_sessions ws ON ws.id = fa.session_id
  JOIN profiles p ON p.id = ws.created_by
  WHERE fa.file_path = p_file_path
    AND fa.session_id != p_session_id
    AND fa.activity_type IN ('write', 'create')
    AND fa.timestamp > NOW() - INTERVAL '30 minutes'
    AND ws.status = 'CONNECTED'
  ORDER BY ws.id, fa.timestamp DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to find best target session for a repo
CREATE OR REPLACE FUNCTION find_session_for_repo(
  p_project_id UUID,
  p_repo_id UUID,
  p_exclude_session_id UUID DEFAULT NULL
)
RETURNS TABLE (
  session_id UUID,
  user_id UUID,
  user_name TEXT,
  last_activity_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ws.id as session_id,
    ws.created_by as user_id,
    COALESCE(p.full_name, p.email) as user_name,
    ws.last_activity_at
  FROM workspace_sessions ws
  JOIN profiles p ON p.id = ws.created_by
  WHERE ws.project_id = p_project_id
    AND ws.repo_id = p_repo_id
    AND ws.status = 'CONNECTED'
    AND (p_exclude_session_id IS NULL OR ws.id != p_exclude_session_id)
  ORDER BY ws.last_activity_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE workspace_file_activity IS 'Tracks file read/write activity for each Claude Code session';
COMMENT ON TABLE workspace_events IS 'Event queue for real-time notifications to sessions';
COMMENT ON TABLE workspace_cross_session_messages IS 'Message queue for cross-session communication';
COMMENT ON FUNCTION detect_file_conflicts IS 'Detects if other sessions have recently modified a file';
COMMENT ON FUNCTION find_session_for_repo IS 'Finds the most recently active session for a repository';
