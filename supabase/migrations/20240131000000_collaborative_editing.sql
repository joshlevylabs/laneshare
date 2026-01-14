-- ============================================================================
-- Collaborative Multi-Agent Editing System
-- Enables multiple Claude agents to work on the same files simultaneously
-- with an Integrator Agent that semantically merges changes
-- ============================================================================

-- Virtual branches for each agent's working state
CREATE TABLE public.virtual_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  codespace_id TEXT, -- GitHub Codespace ID if using Codespaces
  agent_session_id UUID, -- Reference to agent session (soft reference for flexibility)
  workspace_session_id UUID, -- Reference to workspace session (soft reference for flexibility)
  name TEXT NOT NULL, -- e.g., "agent-a-task-123"
  base_sha TEXT NOT NULL, -- The commit SHA this branch is based on
  current_sha TEXT, -- Virtual SHA representing current state
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'MERGING', 'MERGED', 'CONFLICT', 'STALE')),
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookup by project and status
CREATE INDEX idx_virtual_branches_project ON public.virtual_branches(project_id, status);

-- Edit stream: captures every file operation from each agent
CREATE TABLE public.edit_stream (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  virtual_branch_id UUID NOT NULL REFERENCES public.virtual_branches(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  -- Edit details
  operation TEXT NOT NULL CHECK (operation IN ('create', 'edit', 'delete', 'rename')),
  file_path TEXT NOT NULL,
  old_file_path TEXT, -- For renames

  -- Content (stored efficiently)
  old_content TEXT,
  new_content TEXT,

  -- Diff representation (more efficient for large files)
  diff_hunks JSONB, -- Array of {start_line, old_lines, new_lines}

  -- Metadata
  lines_added INTEGER DEFAULT 0,
  lines_removed INTEGER DEFAULT 0,

  -- Agent context
  agent_reasoning TEXT, -- Why the agent made this change
  related_task_id UUID REFERENCES public.tasks(id),

  -- Timing
  sequence_num BIGINT NOT NULL, -- Order within the branch
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- For conflict detection
  file_hash_before TEXT,
  file_hash_after TEXT
);

-- Indexes for edit stream queries
CREATE INDEX idx_edit_stream_branch ON public.edit_stream(virtual_branch_id, sequence_num);
CREATE INDEX idx_edit_stream_file ON public.edit_stream(project_id, file_path, created_at);
CREATE INDEX idx_edit_stream_time ON public.edit_stream(project_id, created_at);

-- Canonical state: the merged "truth" that all agents sync to
CREATE TABLE public.canonical_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  codespace_id TEXT,

  -- Current state
  current_sha TEXT NOT NULL,
  last_merge_at TIMESTAMPTZ,

  -- Tracking
  total_merges INTEGER DEFAULT 0,
  total_conflicts_resolved INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(project_id, codespace_id)
);

-- Merge events: records of integrator agent merges
CREATE TABLE public.merge_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  canonical_state_id UUID REFERENCES public.canonical_state(id),

  -- Branches involved
  source_branches UUID[] NOT NULL, -- Array of virtual_branch_ids that were merged

  -- Files affected
  files_merged JSONB NOT NULL, -- Array of {path, strategy, had_conflict}

  -- Merge details
  merge_strategy TEXT NOT NULL CHECK (merge_strategy IN (
    'AUTO', -- No conflicts, simple merge
    'SEMANTIC', -- Integrator agent merged semantically
    'REFACTOR', -- Required refactoring to merge
    'PARTIAL', -- Some files merged, some need review
    'FAILED' -- Could not merge, needs human intervention
  )),

  -- Integrator agent's work
  integrator_reasoning TEXT, -- Explanation of merge decisions
  integrator_prompt TEXT, -- The prompt sent to integrator
  integrator_response TEXT, -- Full response from integrator

  -- Results
  result_sha TEXT,
  conflicts_detected INTEGER DEFAULT 0,
  conflicts_resolved INTEGER DEFAULT 0,

  -- Validation
  tests_run BOOLEAN DEFAULT false,
  tests_passed BOOLEAN,
  test_output TEXT,

  -- Timing
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_merge_events_project ON public.merge_events(project_id, created_at);

-- Conflict records: detailed tracking of detected conflicts
CREATE TABLE public.edit_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merge_event_id UUID REFERENCES public.merge_events(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  -- Conflict details
  file_path TEXT NOT NULL,
  conflict_type TEXT NOT NULL CHECK (conflict_type IN (
    'SAME_LINE', -- Both edited same line
    'SAME_FUNCTION', -- Both edited same function
    'SAME_BLOCK', -- Both edited overlapping regions
    'LOGICAL', -- Semantically incompatible changes
    'DELETE_MODIFY', -- One deleted, other modified
    'RENAME_CONFLICT' -- Conflicting renames
  )),

  -- The conflicting edits
  edit_a_id UUID REFERENCES public.edit_stream(id),
  edit_b_id UUID REFERENCES public.edit_stream(id),

  -- Content versions
  version_a TEXT,
  version_b TEXT,
  merged_version TEXT, -- Result after integrator merge

  -- Resolution
  resolution_strategy TEXT CHECK (resolution_strategy IN (
    'TAKE_A', 'TAKE_B', 'MERGE_BOTH', 'REFACTOR', 'MANUAL'
  )),
  resolution_reasoning TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT, -- 'integrator' or user_id

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conflicts_merge ON public.edit_conflicts(merge_event_id);
CREATE INDEX idx_conflicts_file ON public.edit_conflicts(project_id, file_path);

-- Agent collaboration status: tracks which agents are working together
CREATE TABLE public.collaboration_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  codespace_id TEXT,

  -- Participating agents
  virtual_branch_ids UUID[] NOT NULL,

  -- Status
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN (
    'ACTIVE', -- Agents actively collaborating
    'PAUSED', -- Paused for merge
    'SYNCING', -- Syncing state after merge
    'COMPLETED', -- All work merged and done
    'ERROR' -- Error state
  )),

  -- Integrator config
  merge_frequency_ms INTEGER DEFAULT 30000, -- How often to check for merges
  auto_merge_enabled BOOLEAN DEFAULT true,
  require_tests BOOLEAN DEFAULT true,

  -- Stats
  total_edits INTEGER DEFAULT 0,
  total_merges INTEGER DEFAULT 0,
  total_conflicts INTEGER DEFAULT 0,

  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_collab_sessions_project ON public.collaboration_sessions(project_id, status);

-- File locks: optional fine-grained locking for specific files/regions
CREATE TABLE public.file_region_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  virtual_branch_id UUID NOT NULL REFERENCES public.virtual_branches(id) ON DELETE CASCADE,

  file_path TEXT NOT NULL,
  -- Optional: lock specific region (function, class, etc.)
  region_type TEXT CHECK (region_type IN ('file', 'function', 'class', 'block', 'lines')),
  region_identifier TEXT, -- e.g., function name or line range "10-50"

  acquired_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ, -- Auto-expire locks

  UNIQUE(project_id, file_path, region_identifier)
);

CREATE INDEX idx_file_locks ON public.file_region_locks(project_id, file_path);

-- ============================================================================
-- Functions for edit stream management
-- ============================================================================

-- Function to get the next sequence number for an edit
CREATE OR REPLACE FUNCTION get_next_edit_sequence(branch_id UUID)
RETURNS BIGINT AS $$
DECLARE
  next_seq BIGINT;
BEGIN
  SELECT COALESCE(MAX(sequence_num), 0) + 1 INTO next_seq
  FROM public.edit_stream
  WHERE virtual_branch_id = branch_id;
  RETURN next_seq;
END;
$$ LANGUAGE plpgsql;

-- Function to detect potential conflicts between branches
CREATE OR REPLACE FUNCTION detect_file_conflicts(
  p_project_id UUID,
  p_since TIMESTAMPTZ DEFAULT NOW() - INTERVAL '5 minutes'
)
RETURNS TABLE (
  file_path TEXT,
  branch_ids UUID[],
  edit_count BIGINT,
  latest_edit TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    es.file_path,
    ARRAY_AGG(DISTINCT es.virtual_branch_id) as branch_ids,
    COUNT(*) as edit_count,
    MAX(es.created_at) as latest_edit
  FROM public.edit_stream es
  JOIN public.virtual_branches vb ON es.virtual_branch_id = vb.id
  WHERE es.project_id = p_project_id
    AND es.created_at >= p_since
    AND vb.status = 'ACTIVE'
  GROUP BY es.file_path
  HAVING COUNT(DISTINCT es.virtual_branch_id) > 1
  ORDER BY edit_count DESC;
END;
$$ LANGUAGE plpgsql;

-- RLS Policies
ALTER TABLE public.virtual_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edit_stream ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merge_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edit_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_region_locks ENABLE ROW LEVEL SECURITY;

-- Policy: Project members can access their project's collaboration data
CREATE POLICY "Project members can access virtual branches"
  ON public.virtual_branches FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = virtual_branches.project_id
        AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Project members can access edit stream"
  ON public.edit_stream FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = edit_stream.project_id
        AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Project members can access canonical state"
  ON public.canonical_state FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = canonical_state.project_id
        AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Project members can access merge events"
  ON public.merge_events FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = merge_events.project_id
        AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Project members can access conflicts"
  ON public.edit_conflicts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = edit_conflicts.project_id
        AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Project members can access collaboration sessions"
  ON public.collaboration_sessions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = collaboration_sessions.project_id
        AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Project members can access file locks"
  ON public.file_region_locks FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = file_region_locks.project_id
        AND pm.user_id = auth.uid()
    )
  );
