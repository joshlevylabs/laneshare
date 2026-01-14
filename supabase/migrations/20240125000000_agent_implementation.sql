-- ===========================================
-- AGENT IMPLEMENTATION FEATURE
-- AI-powered code implementation for tasks
-- ===========================================

-- ===========================================
-- ENUMS
-- ===========================================

-- Agent execution status
CREATE TYPE public.agent_execution_status AS ENUM (
  'PENDING',
  'RUNNING',
  'WAITING_FEEDBACK',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'STUCK'
);

-- File operation types
CREATE TYPE public.file_operation_type AS ENUM (
  'CREATE',
  'UPDATE',
  'DELETE',
  'RENAME'
);

-- Agent loop stages
CREATE TYPE public.agent_loop_stage AS ENUM (
  'INITIALIZING',
  'ANALYZING_TASK',
  'PLANNING',
  'IMPLEMENTING',
  'VERIFYING',
  'COMMITTING',
  'CREATING_PR',
  'AWAITING_FEEDBACK',
  'ITERATING',
  'FINALIZING'
);

-- Extend task_activity_kind for agent implementation events
ALTER TYPE public.task_activity_kind ADD VALUE IF NOT EXISTS 'AGENT_IMPLEMENTATION_STARTED';
ALTER TYPE public.task_activity_kind ADD VALUE IF NOT EXISTS 'AGENT_IMPLEMENTATION_COMPLETED';
ALTER TYPE public.task_activity_kind ADD VALUE IF NOT EXISTS 'AGENT_IMPLEMENTATION_FAILED';
ALTER TYPE public.task_activity_kind ADD VALUE IF NOT EXISTS 'AGENT_ITERATION_COMPLETED';

-- ===========================================
-- AGENT EXECUTION SESSIONS
-- Tracks an implementation attempt for a task
-- ===========================================

CREATE TABLE public.agent_execution_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Status tracking
  status public.agent_execution_status NOT NULL DEFAULT 'PENDING',
  stage public.agent_loop_stage DEFAULT 'INITIALIZING',

  -- Branch info
  source_branch TEXT NOT NULL,  -- e.g., 'main'
  implementation_branch TEXT NOT NULL,  -- e.g., 'ai/LS-123-feature-name'

  -- Progress tracking
  current_iteration INTEGER DEFAULT 0,
  max_iterations INTEGER DEFAULT 10,
  progress_json JSONB DEFAULT '{}',  -- {stage, message, filesModified, etc.}

  -- Results
  total_files_changed INTEGER DEFAULT 0,
  pr_number INTEGER,
  pr_url TEXT,
  final_commit_sha TEXT,

  -- Error tracking
  error_message TEXT,
  stuck_reason TEXT,

  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for agent_execution_sessions
CREATE INDEX idx_agent_exec_sessions_task ON public.agent_execution_sessions(task_id);
CREATE INDEX idx_agent_exec_sessions_repo ON public.agent_execution_sessions(repo_id);
CREATE INDEX idx_agent_exec_sessions_status ON public.agent_execution_sessions(status);
CREATE INDEX idx_agent_exec_sessions_project ON public.agent_execution_sessions(project_id);

-- ===========================================
-- AGENT ITERATIONS
-- Each loop iteration within a session
-- ===========================================

CREATE TABLE public.agent_iterations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.agent_execution_sessions(id) ON DELETE CASCADE,
  iteration_number INTEGER NOT NULL,

  -- What the agent did
  prompt_sent TEXT,  -- Prompt sent to Claude
  response_received TEXT,  -- Claude's response

  -- Verification results
  verification_results JSONB,  -- {passed: bool, items: [{criterion, passed, reason}]}
  criteria_passed INTEGER DEFAULT 0,
  criteria_total INTEGER DEFAULT 0,

  -- Outcome
  changes_made JSONB DEFAULT '[]',  -- [{file, operation, summary}]
  commit_sha TEXT,
  commit_message TEXT,

  -- Error/block info
  blocked_reason TEXT,
  needs_human_input BOOLEAN DEFAULT false,
  human_feedback TEXT,

  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  UNIQUE(session_id, iteration_number)
);

-- Index for agent_iterations
CREATE INDEX idx_agent_iterations_session ON public.agent_iterations(session_id);

-- ===========================================
-- AGENT FILE OPERATIONS
-- Track all file changes for rollback capability
-- ===========================================

CREATE TABLE public.agent_file_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.agent_execution_sessions(id) ON DELETE CASCADE,
  iteration_id UUID REFERENCES public.agent_iterations(id) ON DELETE SET NULL,

  -- File info
  file_path TEXT NOT NULL,
  operation public.file_operation_type NOT NULL,

  -- Content for rollback
  before_sha TEXT,  -- SHA before change (null for CREATE)
  after_sha TEXT,   -- SHA after change (null for DELETE)
  before_content TEXT,  -- Content before (for rollback)

  -- Metadata
  language TEXT,
  lines_added INTEGER DEFAULT 0,
  lines_removed INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for agent_file_operations
CREATE INDEX idx_agent_file_ops_session ON public.agent_file_operations(session_id);
CREATE INDEX idx_agent_file_ops_path ON public.agent_file_operations(file_path);

-- ===========================================
-- AGENT FEEDBACK
-- Human feedback during stuck states
-- ===========================================

CREATE TABLE public.agent_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.agent_execution_sessions(id) ON DELETE CASCADE,
  iteration_id UUID REFERENCES public.agent_iterations(id) ON DELETE SET NULL,

  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('guidance', 'approval', 'rejection', 'abort')),
  content TEXT NOT NULL,

  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for agent_feedback
CREATE INDEX idx_agent_feedback_session ON public.agent_feedback(session_id);

-- ===========================================
-- ROW LEVEL SECURITY
-- ===========================================

ALTER TABLE public.agent_execution_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_iterations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_file_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_feedback ENABLE ROW LEVEL SECURITY;

-- Helper function to check session membership via project
CREATE OR REPLACE FUNCTION public.is_agent_session_member(p_session_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.agent_execution_sessions s
    JOIN public.project_members pm ON s.project_id = pm.project_id
    WHERE s.id = p_session_id AND pm.user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Agent Execution Sessions RLS
CREATE POLICY "Project members can view agent sessions"
  ON public.agent_execution_sessions FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Maintainers can create agent sessions"
  ON public.agent_execution_sessions FOR INSERT
  WITH CHECK (
    public.is_project_admin(project_id) AND auth.uid() = created_by
  );

CREATE POLICY "Maintainers can update agent sessions"
  ON public.agent_execution_sessions FOR UPDATE
  USING (public.is_project_admin(project_id));

CREATE POLICY "Service role full access to agent sessions"
  ON public.agent_execution_sessions FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Agent Iterations RLS (via session membership)
CREATE POLICY "Project members can view iterations"
  ON public.agent_iterations FOR SELECT
  USING (public.is_agent_session_member(session_id));

CREATE POLICY "Service role full access to iterations"
  ON public.agent_iterations FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Agent File Operations RLS
CREATE POLICY "Project members can view file operations"
  ON public.agent_file_operations FOR SELECT
  USING (public.is_agent_session_member(session_id));

CREATE POLICY "Service role full access to file operations"
  ON public.agent_file_operations FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Agent Feedback RLS
CREATE POLICY "Project members can view feedback"
  ON public.agent_feedback FOR SELECT
  USING (public.is_agent_session_member(session_id));

CREATE POLICY "Project members can create feedback"
  ON public.agent_feedback FOR INSERT
  WITH CHECK (
    public.is_agent_session_member(session_id) AND auth.uid() = created_by
  );

CREATE POLICY "Service role full access to feedback"
  ON public.agent_feedback FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ===========================================
-- TRIGGER FOR updated_at
-- ===========================================

CREATE TRIGGER update_agent_exec_sessions_updated_at
  BEFORE UPDATE ON public.agent_execution_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
