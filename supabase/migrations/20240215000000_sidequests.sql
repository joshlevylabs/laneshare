-- ===========================================
-- SIDEQUESTS: Intelligent Planning Agent System
-- Transform "PRD to Sprint" into a collaborative planning experience
-- ===========================================

-- ===========================================
-- ENUM TYPES
-- ===========================================

CREATE TYPE sidequest_status AS ENUM (
  'PLANNING',      -- Initial state, AI chat active
  'READY',         -- Plan finalized, awaiting implementation
  'IN_PROGRESS',   -- Implementation session active
  'PAUSED',        -- Implementation paused
  'COMPLETED',     -- All tickets implemented
  'ARCHIVED'       -- Archived by user
);

CREATE TYPE sidequest_ticket_type AS ENUM (
  'EPIC',          -- Level 1: Major feature/initiative
  'STORY',         -- Level 2: User-facing functionality
  'TASK',          -- Level 3: Technical work item
  'SUBTASK'        -- Level 4: Granular step
);

CREATE TYPE sidequest_ticket_status AS ENUM (
  'PENDING',       -- Not yet approved
  'APPROVED',      -- Approved for implementation
  'IN_PROGRESS',   -- Currently being implemented
  'REVIEW',        -- Implementation done, awaiting review
  'COMPLETED',     -- Implementation approved
  'SKIPPED'        -- Skipped by user
);

CREATE TYPE sidequest_implementation_status AS ENUM (
  'IDLE',              -- No active implementation
  'IMPLEMENTING',      -- Actively implementing current ticket
  'AWAITING_REVIEW',   -- Waiting for user review
  'PAUSED',            -- Paused by user
  'COMPLETED'          -- All tickets processed
);

-- ===========================================
-- SIDEQUESTS TABLE (Main entity)
-- ===========================================

CREATE TABLE public.sidequests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  -- Basic info
  title VARCHAR(200) NOT NULL,
  description TEXT,

  -- Multi-repo scope (array of repo IDs this sidequest spans)
  repo_ids UUID[] NOT NULL DEFAULT '{}',

  -- Status tracking
  status sidequest_status NOT NULL DEFAULT 'PLANNING',

  -- Plan JSON (hierarchical structure for quick access)
  plan_json JSONB,

  -- Progress tracking
  total_tickets INTEGER NOT NULL DEFAULT 0,
  completed_tickets INTEGER NOT NULL DEFAULT 0,

  -- Migration from PRD
  migrated_from_prd_id UUID REFERENCES public.project_prds(id) ON DELETE SET NULL,

  -- Metadata
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1
);

-- ===========================================
-- SIDEQUEST TICKETS TABLE (Hierarchical plan items)
-- ===========================================

CREATE TABLE public.sidequest_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sidequest_id UUID NOT NULL REFERENCES public.sidequests(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  -- Hierarchy (self-referential for parent-child relationships)
  parent_ticket_id UUID REFERENCES public.sidequest_tickets(id) ON DELETE CASCADE,
  ticket_type sidequest_ticket_type NOT NULL,
  hierarchy_level INTEGER NOT NULL CHECK (hierarchy_level BETWEEN 1 AND 4),
  sort_order INTEGER NOT NULL DEFAULT 0,

  -- Content
  title VARCHAR(500) NOT NULL,
  description TEXT,
  acceptance_criteria JSONB DEFAULT '[]'::jsonb,

  -- Estimation and planning
  priority VARCHAR(10) CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  story_points INTEGER CHECK (story_points BETWEEN 1 AND 13),
  sprint_group INTEGER,

  -- AI-analyzed context links (stored as arrays for quick access)
  linked_repo_ids UUID[] DEFAULT '{}',
  linked_doc_ids UUID[] DEFAULT '{}',
  linked_feature_ids UUID[] DEFAULT '{}',
  context_analysis JSONB,

  -- Status tracking
  status sidequest_ticket_status NOT NULL DEFAULT 'PENDING',
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Link to actual task when created during finalization
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,

  -- Implementation result (stored after implementation)
  implementation_result JSONB,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add current_ticket_id reference after sidequest_tickets exists
ALTER TABLE public.sidequests
  ADD COLUMN current_ticket_id UUID REFERENCES public.sidequest_tickets(id) ON DELETE SET NULL;

-- ===========================================
-- SIDEQUEST CHAT MESSAGES TABLE (AI planning conversation)
-- ===========================================

CREATE TABLE public.sidequest_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sidequest_id UUID NOT NULL REFERENCES public.sidequests(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  -- Message content
  sender VARCHAR(10) NOT NULL CHECK (sender IN ('USER', 'AI', 'SYSTEM')),
  content TEXT NOT NULL,

  -- AI can suggest plan updates
  plan_suggestions JSONB,

  -- Quick response options
  options JSONB,

  -- Clarifying questions tracking
  question_type VARCHAR(50),

  -- Metadata
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================
-- SIDEQUEST IMPLEMENTATION SESSIONS TABLE
-- ===========================================

CREATE TABLE public.sidequest_implementation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sidequest_id UUID NOT NULL REFERENCES public.sidequests(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  -- Current ticket being implemented
  current_ticket_id UUID REFERENCES public.sidequest_tickets(id) ON DELETE SET NULL,

  -- Workspace integration
  workspace_session_id UUID REFERENCES public.workspace_sessions(id) ON DELETE SET NULL,

  -- Status
  status sidequest_implementation_status NOT NULL DEFAULT 'IDLE',

  -- Progress tracking
  tickets_implemented INTEGER NOT NULL DEFAULT 0,
  tickets_skipped INTEGER NOT NULL DEFAULT 0,

  -- Configuration
  auto_advance BOOLEAN NOT NULL DEFAULT false,
  pause_on_failure BOOLEAN NOT NULL DEFAULT true,

  -- Metadata
  started_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================
-- INDEXES
-- ===========================================

-- Sidequests
CREATE INDEX idx_sidequests_project ON public.sidequests(project_id);
CREATE INDEX idx_sidequests_status ON public.sidequests(status);
CREATE INDEX idx_sidequests_created_by ON public.sidequests(created_by);
CREATE INDEX idx_sidequests_migrated_from ON public.sidequests(migrated_from_prd_id) WHERE migrated_from_prd_id IS NOT NULL;

-- Sidequest tickets
CREATE INDEX idx_sidequest_tickets_sidequest ON public.sidequest_tickets(sidequest_id);
CREATE INDEX idx_sidequest_tickets_parent ON public.sidequest_tickets(parent_ticket_id) WHERE parent_ticket_id IS NOT NULL;
CREATE INDEX idx_sidequest_tickets_status ON public.sidequest_tickets(status);
CREATE INDEX idx_sidequest_tickets_type ON public.sidequest_tickets(ticket_type);
CREATE INDEX idx_sidequest_tickets_sprint ON public.sidequest_tickets(sprint_group) WHERE sprint_group IS NOT NULL;
CREATE INDEX idx_sidequest_tickets_task ON public.sidequest_tickets(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX idx_sidequest_tickets_sort ON public.sidequest_tickets(sidequest_id, parent_ticket_id, sort_order);

-- Chat messages
CREATE INDEX idx_sidequest_chat_sidequest ON public.sidequest_chat_messages(sidequest_id, created_at);
CREATE INDEX idx_sidequest_chat_sender ON public.sidequest_chat_messages(sidequest_id, sender);

-- Implementation sessions
CREATE INDEX idx_sidequest_impl_sidequest ON public.sidequest_implementation_sessions(sidequest_id);
CREATE INDEX idx_sidequest_impl_status ON public.sidequest_implementation_sessions(status);
CREATE INDEX idx_sidequest_impl_workspace ON public.sidequest_implementation_sessions(workspace_session_id) WHERE workspace_session_id IS NOT NULL;

-- Unique constraint: only one active implementation session per sidequest
CREATE UNIQUE INDEX idx_sidequest_impl_active
  ON public.sidequest_implementation_sessions(sidequest_id)
  WHERE status IN ('IMPLEMENTING', 'AWAITING_REVIEW', 'PAUSED');

-- ===========================================
-- ROW LEVEL SECURITY
-- ===========================================

ALTER TABLE public.sidequests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sidequest_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sidequest_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sidequest_implementation_sessions ENABLE ROW LEVEL SECURITY;

-- Sidequests policies
CREATE POLICY "Project members can view sidequests"
  ON public.sidequests FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create sidequests"
  ON public.sidequests FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY "Project members can update sidequests"
  ON public.sidequests FOR UPDATE
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can delete sidequests"
  ON public.sidequests FOR DELETE
  USING (public.is_project_member(project_id));

-- Sidequest tickets policies
CREATE POLICY "Project members can view sidequest tickets"
  ON public.sidequest_tickets FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create sidequest tickets"
  ON public.sidequest_tickets FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY "Project members can update sidequest tickets"
  ON public.sidequest_tickets FOR UPDATE
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can delete sidequest tickets"
  ON public.sidequest_tickets FOR DELETE
  USING (public.is_project_member(project_id));

-- Chat messages policies
CREATE POLICY "Project members can view sidequest chat"
  ON public.sidequest_chat_messages FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create sidequest chat"
  ON public.sidequest_chat_messages FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

-- Implementation sessions policies
CREATE POLICY "Project members can view implementation sessions"
  ON public.sidequest_implementation_sessions FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create implementation sessions"
  ON public.sidequest_implementation_sessions FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY "Project members can update implementation sessions"
  ON public.sidequest_implementation_sessions FOR UPDATE
  USING (public.is_project_member(project_id));

-- ===========================================
-- TRIGGERS
-- ===========================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_sidequest_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_sidequests_updated_at
  BEFORE UPDATE ON public.sidequests
  FOR EACH ROW EXECUTE FUNCTION update_sidequest_updated_at();

CREATE TRIGGER trigger_sidequest_tickets_updated_at
  BEFORE UPDATE ON public.sidequest_tickets
  FOR EACH ROW EXECUTE FUNCTION update_sidequest_updated_at();

CREATE TRIGGER trigger_sidequest_impl_updated_at
  BEFORE UPDATE ON public.sidequest_implementation_sessions
  FOR EACH ROW EXECUTE FUNCTION update_sidequest_updated_at();

-- Auto-update ticket counts when tickets change
CREATE OR REPLACE FUNCTION update_sidequest_ticket_counts()
RETURNS TRIGGER AS $$
DECLARE
  sq_id UUID;
BEGIN
  -- Get the sidequest_id from either the new or old record
  sq_id := COALESCE(NEW.sidequest_id, OLD.sidequest_id);

  -- Update the counts
  UPDATE public.sidequests
  SET
    total_tickets = (
      SELECT COUNT(*) FROM public.sidequest_tickets WHERE sidequest_id = sq_id
    ),
    completed_tickets = (
      SELECT COUNT(*) FROM public.sidequest_tickets
      WHERE sidequest_id = sq_id AND status = 'COMPLETED'
    ),
    updated_at = now()
  WHERE id = sq_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_sidequest_counts
  AFTER INSERT OR UPDATE OR DELETE ON public.sidequest_tickets
  FOR EACH ROW EXECUTE FUNCTION update_sidequest_ticket_counts();

-- ===========================================
-- COMMENTS
-- ===========================================

COMMENT ON TABLE public.sidequests IS 'Sidequests - intelligent planning sessions with AI assistance';
COMMENT ON TABLE public.sidequest_tickets IS 'Hierarchical plan items generated during sidequest planning';
COMMENT ON TABLE public.sidequest_chat_messages IS 'AI planning conversation history for sidequests';
COMMENT ON TABLE public.sidequest_implementation_sessions IS 'Tracks sequential implementation progress of sidequest tickets';

COMMENT ON COLUMN public.sidequests.repo_ids IS 'Array of repository IDs this sidequest spans (multi-repo support)';
COMMENT ON COLUMN public.sidequests.plan_json IS 'Hierarchical plan structure for quick rendering';
COMMENT ON COLUMN public.sidequests.migrated_from_prd_id IS 'Reference to original PRD if migrated';

COMMENT ON COLUMN public.sidequest_tickets.hierarchy_level IS '1=Epic, 2=Story, 3=Task, 4=Subtask';
COMMENT ON COLUMN public.sidequest_tickets.context_analysis IS 'AI-generated analysis of relevant project context';
COMMENT ON COLUMN public.sidequest_tickets.task_id IS 'Link to actual task created during plan finalization';
COMMENT ON COLUMN public.sidequest_tickets.implementation_result IS 'Result after implementation: {success, pr_url, commit_sha, notes}';

COMMENT ON COLUMN public.sidequest_chat_messages.plan_suggestions IS 'AI suggestions for plan updates: [{action, parent_id, data}]';
COMMENT ON COLUMN public.sidequest_chat_messages.options IS 'Quick response options: [{label, value, recommended}]';

COMMENT ON COLUMN public.sidequest_implementation_sessions.auto_advance IS 'Auto-advance to next ticket after approval';
COMMENT ON COLUMN public.sidequest_implementation_sessions.pause_on_failure IS 'Pause implementation on ticket failure';
