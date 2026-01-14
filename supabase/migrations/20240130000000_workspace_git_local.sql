-- ===========================================
-- WORKSPACE GIT LOCAL
-- Local repo clones and file activity tracking
-- ===========================================

-- ===========================================
-- LOCAL REPO CLONES
-- Track repos that have been cloned locally for workspace sessions
-- ===========================================

CREATE TABLE public.local_repo_clones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  -- Local path info
  local_path TEXT NOT NULL,  -- Path on local server filesystem
  local_server_host TEXT NOT NULL DEFAULT 'localhost:7890',

  -- Clone status
  clone_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (clone_status IN (
    'PENDING', 'CLONING', 'CLONED', 'ERROR', 'STALE'
  )),
  clone_error TEXT,
  cloned_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,  -- Last pull from remote

  -- Git state
  current_branch TEXT,
  current_sha TEXT,
  remote_sha TEXT,  -- Latest known remote SHA
  is_dirty BOOLEAN DEFAULT false,  -- Has uncommitted changes
  ahead_count INTEGER DEFAULT 0,
  behind_count INTEGER DEFAULT 0,

  -- Metadata
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_local_repo_clones_repo ON public.local_repo_clones(repo_id);
CREATE INDEX idx_local_repo_clones_project ON public.local_repo_clones(project_id);
CREATE UNIQUE INDEX idx_local_repo_clones_path ON public.local_repo_clones(local_path);
CREATE INDEX idx_local_repo_clones_status ON public.local_repo_clones(clone_status);

-- ===========================================
-- WORKSPACE FILE ACTIVITY
-- Real-time log of file operations during Claude Code sessions
-- ===========================================

CREATE TABLE public.workspace_file_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.workspace_sessions(id) ON DELETE CASCADE,

  -- Activity details
  activity_type TEXT NOT NULL CHECK (activity_type IN (
    'read', 'write', 'create', 'delete', 'rename'
  )),
  file_path TEXT NOT NULL,

  -- Change details
  lines_read INTEGER,
  lines_added INTEGER,
  lines_removed INTEGER,

  -- Preview (for UI display)
  change_preview TEXT,  -- First ~200 chars of change

  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_workspace_file_activity_session ON public.workspace_file_activity(session_id);
CREATE INDEX idx_workspace_file_activity_timestamp ON public.workspace_file_activity(session_id, timestamp DESC);
CREATE INDEX idx_workspace_file_activity_type ON public.workspace_file_activity(activity_type);

-- ===========================================
-- ADD COLUMNS TO EXISTING TABLES
-- ===========================================

-- Add local clone reference to workspace_sessions
ALTER TABLE public.workspace_sessions
  ADD COLUMN IF NOT EXISTS local_clone_id UUID REFERENCES public.local_repo_clones(id) ON DELETE SET NULL;

-- Add index
CREATE INDEX IF NOT EXISTS idx_workspace_sessions_clone ON public.workspace_sessions(local_clone_id);

-- ===========================================
-- TRIGGER FOR updated_at
-- ===========================================

CREATE TRIGGER update_local_repo_clones_updated_at
  BEFORE UPDATE ON public.local_repo_clones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ===========================================
-- ROW LEVEL SECURITY
-- ===========================================

ALTER TABLE public.local_repo_clones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_file_activity ENABLE ROW LEVEL SECURITY;

-- Local repo clones policies
CREATE POLICY "Project members can view local clones"
  ON public.local_repo_clones FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project admins can insert local clones"
  ON public.local_repo_clones FOR INSERT
  WITH CHECK (public.is_project_admin(project_id) AND auth.uid() = created_by);

CREATE POLICY "Project admins can update local clones"
  ON public.local_repo_clones FOR UPDATE
  USING (public.is_project_admin(project_id));

CREATE POLICY "Project admins can delete local clones"
  ON public.local_repo_clones FOR DELETE
  USING (public.is_project_admin(project_id));

CREATE POLICY "Service role full access to local clones"
  ON public.local_repo_clones FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Workspace file activity policies (via session membership)
CREATE POLICY "Project members can view file activity"
  ON public.workspace_file_activity FOR SELECT
  USING (
    session_id IN (
      SELECT ws.id FROM public.workspace_sessions ws
      WHERE public.is_project_member(ws.project_id)
    )
  );

CREATE POLICY "Project members can insert file activity"
  ON public.workspace_file_activity FOR INSERT
  WITH CHECK (
    session_id IN (
      SELECT ws.id FROM public.workspace_sessions ws
      WHERE public.is_project_member(ws.project_id)
    )
  );

CREATE POLICY "Service role full access to file activity"
  ON public.workspace_file_activity FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
