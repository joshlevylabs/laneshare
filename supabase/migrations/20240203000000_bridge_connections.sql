-- ===========================================
-- BRIDGE CONNECTIONS
-- Track bridge agents connected from Codespaces
-- ===========================================

-- ===========================================
-- BRIDGE API KEYS
-- API keys for authenticating bridge agents
-- ===========================================

CREATE TABLE bridge_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Key info
  key_hash TEXT NOT NULL,  -- SHA256 hash of the key (we don't store the key itself)
  key_prefix TEXT NOT NULL,  -- First 8 chars for identification
  name TEXT NOT NULL,  -- User-friendly name

  -- Permissions
  scopes TEXT[] NOT NULL DEFAULT ARRAY['bridge:connect', 'bridge:write'],

  -- Status
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,  -- Optional expiration

  -- Metadata
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_bridge_api_keys_project ON bridge_api_keys(project_id);
CREATE INDEX idx_bridge_api_keys_prefix ON bridge_api_keys(key_prefix);
CREATE INDEX idx_bridge_api_keys_active ON bridge_api_keys(project_id, is_active);

-- ===========================================
-- BRIDGE CONNECTIONS
-- Active bridge connections from Codespaces
-- ===========================================

CREATE TABLE bridge_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES workspace_sessions(id) ON DELETE CASCADE,

  -- Bridge info
  bridge_version TEXT NOT NULL,
  work_dir TEXT NOT NULL,
  git_branch TEXT,
  git_remote TEXT,

  -- Connection status
  status TEXT NOT NULL DEFAULT 'CONNECTED' CHECK (status IN (
    'CONNECTED', 'DISCONNECTED', 'STALE'
  )),
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  disconnected_at TIMESTAMPTZ,
  last_ping_at TIMESTAMPTZ DEFAULT NOW(),

  -- Codespace info (if applicable)
  codespace_name TEXT,
  codespace_id INTEGER,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_bridge_connections_project ON bridge_connections(project_id);
CREATE INDEX idx_bridge_connections_session ON bridge_connections(session_id);
CREATE INDEX idx_bridge_connections_status ON bridge_connections(status);
CREATE UNIQUE INDEX idx_bridge_connections_session_active ON bridge_connections(session_id)
  WHERE status = 'CONNECTED';

-- ===========================================
-- BRIDGE PROMPT QUEUE
-- Queue of prompts waiting to be sent to bridge
-- ===========================================

CREATE TABLE bridge_prompt_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES workspace_sessions(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES bridge_connections(id) ON DELETE SET NULL,

  -- Prompt content
  prompt TEXT NOT NULL,
  session_message_id UUID REFERENCES workspace_messages(id) ON DELETE CASCADE,

  -- Status
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'SENT', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'
  )),
  sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,

  -- Metadata
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_bridge_prompt_queue_session ON bridge_prompt_queue(session_id);
CREATE INDEX idx_bridge_prompt_queue_status ON bridge_prompt_queue(session_id, status);
CREATE INDEX idx_bridge_prompt_queue_pending ON bridge_prompt_queue(session_id, created_at)
  WHERE status = 'PENDING';

-- ===========================================
-- TRIGGERS
-- ===========================================

CREATE TRIGGER update_bridge_api_keys_updated_at
  BEFORE UPDATE ON bridge_api_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_bridge_connections_updated_at
  BEFORE UPDATE ON bridge_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ===========================================
-- ROW LEVEL SECURITY
-- ===========================================

ALTER TABLE bridge_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_prompt_queue ENABLE ROW LEVEL SECURITY;

-- Bridge API keys policies
CREATE POLICY "Project admins can manage API keys"
  ON bridge_api_keys FOR ALL
  USING (is_project_admin(project_id))
  WITH CHECK (is_project_admin(project_id));

CREATE POLICY "Service role full access to API keys"
  ON bridge_api_keys FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Bridge connections policies
CREATE POLICY "Project members can view connections"
  ON bridge_connections FOR SELECT
  USING (is_project_member(project_id));

CREATE POLICY "Service role full access to connections"
  ON bridge_connections FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Bridge prompt queue policies
CREATE POLICY "Project members can view prompts"
  ON bridge_prompt_queue FOR SELECT
  USING (
    session_id IN (
      SELECT ws.id FROM workspace_sessions ws
      WHERE is_project_member(ws.project_id)
    )
  );

CREATE POLICY "Project members can create prompts"
  ON bridge_prompt_queue FOR INSERT
  WITH CHECK (
    session_id IN (
      SELECT ws.id FROM workspace_sessions ws
      WHERE is_project_member(ws.project_id)
    )
    AND auth.uid() = created_by
  );

CREATE POLICY "Service role full access to prompts"
  ON bridge_prompt_queue FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ===========================================
-- ADD COLUMNS TO WORKSPACE SESSIONS
-- ===========================================

-- Add codespace reference to workspace_sessions
ALTER TABLE workspace_sessions
  ADD COLUMN IF NOT EXISTS codespace_name TEXT,
  ADD COLUMN IF NOT EXISTS codespace_state TEXT,
  ADD COLUMN IF NOT EXISTS bridge_connected BOOLEAN DEFAULT false;
