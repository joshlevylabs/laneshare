-- ===========================================
-- SYSTEM MAP FEATURE
-- Hierarchical, grounded system documentation and flowcharts
-- ===========================================

-- ===========================================
-- ENUMS
-- ===========================================

CREATE TYPE system_status AS ENUM (
  'DRAFT',
  'NEEDS_AGENT_OUTPUT',
  'GROUNDED',
  'NEEDS_REVIEW'
);

CREATE TYPE artifact_kind AS ENUM (
  'USER_BRIEF',
  'GROUNDED_FINDINGS',
  'AGENT_PROMPT',
  'AGENT_OUTPUT',
  'SYSTEM_SPEC',
  'FLOW_SNAPSHOT',
  'DOC_UPDATE'
);

CREATE TYPE evidence_source_type AS ENUM (
  'DOC',
  'REPO',
  'AGENT'
);

CREATE TYPE evidence_confidence AS ENUM (
  'HIGH',
  'MED',
  'LOW'
);

CREATE TYPE system_node_type AS ENUM (
  'UI',
  'API',
  'SERVICE',
  'DATA',
  'WORKER',
  'EXTERNAL',
  'DOC',
  'UNKNOWN'
);

CREATE TYPE system_edge_kind AS ENUM (
  'CALLS',
  'READS',
  'WRITES',
  'TRIGGERS',
  'CONFIGURES'
);

-- ===========================================
-- SYSTEMS TABLE
-- Core system definition
-- ===========================================

CREATE TABLE public.systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  in_scope TEXT,
  out_of_scope TEXT,
  keywords TEXT[] DEFAULT '{}',
  repo_ids UUID[] DEFAULT '{}',
  status system_status NOT NULL DEFAULT 'DRAFT',
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, slug)
);

CREATE INDEX systems_project_idx ON public.systems (project_id);
CREATE INDEX systems_status_idx ON public.systems (status);
CREATE INDEX systems_slug_idx ON public.systems (project_id, slug);

-- ===========================================
-- SYSTEM ARTIFACTS TABLE
-- Stores all artifacts generated during system analysis
-- ===========================================

CREATE TABLE public.system_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  system_id UUID NOT NULL REFERENCES public.systems(id) ON DELETE CASCADE,
  kind artifact_kind NOT NULL,
  content TEXT NOT NULL,
  content_json JSONB,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX system_artifacts_system_idx ON public.system_artifacts (system_id);
CREATE INDEX system_artifacts_kind_idx ON public.system_artifacts (system_id, kind);

-- ===========================================
-- SYSTEM EVIDENCE TABLE
-- Tracks evidence for grounding nodes/edges
-- ===========================================

CREATE TABLE public.system_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  system_id UUID NOT NULL REFERENCES public.systems(id) ON DELETE CASCADE,
  source_type evidence_source_type NOT NULL,
  source_ref TEXT NOT NULL,  -- doc slug, repo_id:file_path, or artifact_id
  excerpt TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',  -- file_path, symbol, line ranges, url
  confidence evidence_confidence NOT NULL DEFAULT 'MED',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX system_evidence_system_idx ON public.system_evidence (system_id);
CREATE INDEX system_evidence_source_idx ON public.system_evidence (source_type, source_ref);

-- ===========================================
-- SYSTEM FLOW SNAPSHOTS TABLE
-- Versioned flowchart snapshots
-- ===========================================

CREATE TABLE public.system_flow_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  system_id UUID NOT NULL REFERENCES public.systems(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  graph_json JSONB NOT NULL,  -- nodes, edges, layout positions, collapsed states
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  generated_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notes TEXT,
  UNIQUE(system_id, version)
);

CREATE INDEX system_flow_snapshots_system_idx ON public.system_flow_snapshots (system_id);
CREATE INDEX system_flow_snapshots_version_idx ON public.system_flow_snapshots (system_id, version DESC);

-- ===========================================
-- SYSTEM NODE VERIFICATIONS TABLE
-- Tracks verification status for nodes/edges
-- ===========================================

CREATE TABLE public.system_node_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  system_id UUID NOT NULL REFERENCES public.systems(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,  -- stable id from graph_json
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  notes TEXT,
  UNIQUE(system_id, node_id)
);

CREATE INDEX system_node_verifications_system_idx ON public.system_node_verifications (system_id);
CREATE INDEX system_node_verifications_verified_idx ON public.system_node_verifications (system_id, is_verified);

-- ===========================================
-- ROW LEVEL SECURITY
-- ===========================================

ALTER TABLE public.systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_flow_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_node_verifications ENABLE ROW LEVEL SECURITY;

-- Systems RLS Policies
CREATE POLICY "Project members can view systems"
  ON public.systems FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create systems"
  ON public.systems FOR INSERT
  WITH CHECK (
    public.is_project_member(project_id) AND
    auth.uid() = created_by
  );

CREATE POLICY "Project admins can update systems"
  ON public.systems FOR UPDATE
  USING (public.is_project_admin(project_id));

CREATE POLICY "Project admins can delete systems"
  ON public.systems FOR DELETE
  USING (public.is_project_admin(project_id));

-- Artifacts RLS Policies
CREATE POLICY "Project members can view artifacts"
  ON public.system_artifacts FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create artifacts"
  ON public.system_artifacts FOR INSERT
  WITH CHECK (
    public.is_project_member(project_id) AND
    auth.uid() = created_by
  );

CREATE POLICY "Project admins can update artifacts"
  ON public.system_artifacts FOR UPDATE
  USING (public.is_project_admin(project_id));

CREATE POLICY "Project admins can delete artifacts"
  ON public.system_artifacts FOR DELETE
  USING (public.is_project_admin(project_id));

-- Evidence RLS Policies
CREATE POLICY "Project members can view evidence"
  ON public.system_evidence FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create evidence"
  ON public.system_evidence FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY "Project admins can update evidence"
  ON public.system_evidence FOR UPDATE
  USING (public.is_project_admin(project_id));

CREATE POLICY "Project admins can delete evidence"
  ON public.system_evidence FOR DELETE
  USING (public.is_project_admin(project_id));

-- Flow Snapshots RLS Policies
CREATE POLICY "Project members can view flow snapshots"
  ON public.system_flow_snapshots FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create flow snapshots"
  ON public.system_flow_snapshots FOR INSERT
  WITH CHECK (
    public.is_project_member(project_id) AND
    auth.uid() = generated_by
  );

CREATE POLICY "Project admins can update flow snapshots"
  ON public.system_flow_snapshots FOR UPDATE
  USING (public.is_project_admin(project_id));

CREATE POLICY "Project admins can delete flow snapshots"
  ON public.system_flow_snapshots FOR DELETE
  USING (public.is_project_admin(project_id));

-- Node Verifications RLS Policies
CREATE POLICY "Project members can view verifications"
  ON public.system_node_verifications FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project admins can create verifications"
  ON public.system_node_verifications FOR INSERT
  WITH CHECK (public.is_project_admin(project_id));

CREATE POLICY "Project admins can update verifications"
  ON public.system_node_verifications FOR UPDATE
  USING (public.is_project_admin(project_id));

CREATE POLICY "Project admins can delete verifications"
  ON public.system_node_verifications FOR DELETE
  USING (public.is_project_admin(project_id));

-- ===========================================
-- TRIGGERS
-- ===========================================

-- Update updated_at on systems changes
CREATE TRIGGER update_systems_updated_at
  BEFORE UPDATE ON public.systems
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Auto-increment snapshot version
CREATE OR REPLACE FUNCTION public.set_snapshot_version()
RETURNS TRIGGER AS $$
DECLARE
  v_max_version INTEGER;
BEGIN
  IF NEW.version IS NULL OR NEW.version = 0 THEN
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_max_version
    FROM public.system_flow_snapshots
    WHERE system_id = NEW.system_id;

    NEW.version := v_max_version;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER set_snapshot_version_trigger
  BEFORE INSERT ON public.system_flow_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.set_snapshot_version();

-- Update system updated_at when artifacts/snapshots change
CREATE OR REPLACE FUNCTION public.update_system_on_child_change()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.systems
  SET updated_at = NOW()
  WHERE id = COALESCE(NEW.system_id, OLD.system_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER update_system_on_artifact_change
  AFTER INSERT OR UPDATE OR DELETE ON public.system_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.update_system_on_child_change();

CREATE TRIGGER update_system_on_snapshot_change
  AFTER INSERT OR UPDATE OR DELETE ON public.system_flow_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.update_system_on_child_change();

CREATE TRIGGER update_system_on_evidence_change
  AFTER INSERT OR UPDATE OR DELETE ON public.system_evidence
  FOR EACH ROW EXECUTE FUNCTION public.update_system_on_child_change();

-- ===========================================
-- HELPER FUNCTIONS
-- ===========================================

-- Get latest snapshot for a system
CREATE OR REPLACE FUNCTION public.get_latest_system_snapshot(p_system_id UUID)
RETURNS public.system_flow_snapshots AS $$
  SELECT * FROM public.system_flow_snapshots
  WHERE system_id = p_system_id
  ORDER BY version DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Count verified nodes for a system
CREATE OR REPLACE FUNCTION public.count_verified_nodes(p_system_id UUID)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.system_node_verifications
  WHERE system_id = p_system_id AND is_verified = TRUE;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check if system has enough grounding
CREATE OR REPLACE FUNCTION public.is_system_grounded(p_system_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_has_agent_output BOOLEAN;
  v_has_evidence BOOLEAN;
  v_verified_count INTEGER;
BEGIN
  -- Check for agent output artifact
  SELECT EXISTS (
    SELECT 1 FROM public.system_artifacts
    WHERE system_id = p_system_id AND kind = 'AGENT_OUTPUT'
  ) INTO v_has_agent_output;

  -- Check for sufficient evidence
  SELECT EXISTS (
    SELECT 1 FROM public.system_evidence
    WHERE system_id = p_system_id
    HAVING COUNT(*) >= 3
  ) INTO v_has_evidence;

  -- Count verified nodes
  SELECT public.count_verified_nodes(p_system_id) INTO v_verified_count;

  RETURN (v_has_agent_output OR v_has_evidence) AND v_verified_count > 0;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Slugify function for system names
CREATE OR REPLACE FUNCTION public.slugify_system_name(p_name TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN LOWER(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        TRIM(p_name),
        '[^a-zA-Z0-9]+', '-', 'g'
      ),
      '^-|-$', '', 'g'
    )
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;
