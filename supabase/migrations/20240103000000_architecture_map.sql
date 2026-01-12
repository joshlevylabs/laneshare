-- ===========================================
-- ARCHITECTURE MAP FEATURE
-- Tables for storing architecture analysis snapshots and evidence
-- ===========================================

-- ===========================================
-- ARCHITECTURE SNAPSHOT
-- Stores the analyzed architecture graph for a project
-- ===========================================
CREATE TABLE public.architecture_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  analyzer_version TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL, -- Hash of repo SHAs + config SHAs for cache invalidation
  graph_json JSONB NOT NULL DEFAULT '{}', -- Full graph: nodes, edges, features
  summary_json JSONB NOT NULL DEFAULT '{}', -- Coverage stats, counts
  status TEXT NOT NULL DEFAULT 'pending', -- pending, analyzing, completed, error
  error_message TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup of latest snapshot per project
CREATE INDEX architecture_snapshots_project_idx
  ON public.architecture_snapshots (project_id, generated_at DESC);

-- Index for fingerprint matching (cache hits)
CREATE INDEX architecture_snapshots_fingerprint_idx
  ON public.architecture_snapshots (project_id, source_fingerprint);

ALTER TABLE public.architecture_snapshots ENABLE ROW LEVEL SECURITY;

-- Project members can view snapshots
CREATE POLICY "Project members can view architecture snapshots"
  ON public.architecture_snapshots FOR SELECT
  USING (public.is_project_member(project_id));

-- Project admins can create snapshots (trigger regeneration)
CREATE POLICY "Project admins can create architecture snapshots"
  ON public.architecture_snapshots FOR INSERT
  WITH CHECK (public.is_project_admin(project_id));

-- Project admins can update snapshots (for status updates)
CREATE POLICY "Project admins can update architecture snapshots"
  ON public.architecture_snapshots FOR UPDATE
  USING (public.is_project_admin(project_id));

-- Project admins can delete old snapshots
CREATE POLICY "Project admins can delete architecture snapshots"
  ON public.architecture_snapshots FOR DELETE
  USING (public.is_project_admin(project_id));

-- ===========================================
-- ARCHITECTURE EVIDENCE
-- Links discovered nodes/edges to source code and config
-- ===========================================
CREATE TYPE evidence_kind AS ENUM (
  'ROUTE_DEF',        -- Next.js/Express route definition
  'API_HANDLER',      -- API endpoint handler
  'PAGE_COMPONENT',   -- React page component
  'DB_TABLE',         -- Database table from migrations
  'DB_FUNCTION',      -- Database function/RPC
  'SQL_MIGRATION',    -- SQL migration file
  'ENV_VAR',          -- Environment variable usage
  'FETCH_CALL',       -- Fetch/axios call to API
  'SUPABASE_CLIENT',  -- Supabase client call
  'VERCEL_CONFIG',    -- Vercel deployment config
  'PACKAGE_DEP',      -- Package.json dependency
  'IMPORT_STMT',      -- Import statement
  'EXTERNAL_API',     -- External API call (non-internal)
  'COMPONENT_USAGE',  -- Component usage/rendering
  'RLS_POLICY'        -- RLS policy definition
);

CREATE TABLE public.architecture_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL REFERENCES public.architecture_snapshots(id) ON DELETE CASCADE,
  kind evidence_kind NOT NULL,
  node_id TEXT NOT NULL, -- References graph_json node ID
  edge_id TEXT, -- References graph_json edge ID if applicable
  repo_id UUID REFERENCES public.repos(id) ON DELETE SET NULL,
  file_path TEXT,
  symbol TEXT, -- function/class/route name
  line_start INTEGER,
  line_end INTEGER,
  excerpt TEXT, -- Short code snippet
  url TEXT, -- GitHub deep link or internal viewer URL
  confidence TEXT NOT NULL DEFAULT 'high', -- high, medium, low
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast evidence lookup by snapshot
CREATE INDEX architecture_evidence_snapshot_idx
  ON public.architecture_evidence (snapshot_id);

-- Index for evidence by node
CREATE INDEX architecture_evidence_node_idx
  ON public.architecture_evidence (snapshot_id, node_id);

-- Index for evidence by edge
CREATE INDEX architecture_evidence_edge_idx
  ON public.architecture_evidence (snapshot_id, edge_id)
  WHERE edge_id IS NOT NULL;

ALTER TABLE public.architecture_evidence ENABLE ROW LEVEL SECURITY;

-- Project members can view evidence
CREATE POLICY "Project members can view architecture evidence"
  ON public.architecture_evidence FOR SELECT
  USING (public.is_project_member(project_id));

-- Project admins can manage evidence (inserted during analysis)
CREATE POLICY "Project admins can create architecture evidence"
  ON public.architecture_evidence FOR INSERT
  WITH CHECK (public.is_project_admin(project_id));

CREATE POLICY "Project admins can delete architecture evidence"
  ON public.architecture_evidence FOR DELETE
  USING (public.is_project_admin(project_id));

-- ===========================================
-- ARCHITECTURE FEATURE INDEX
-- Extracted feature flows for quick access
-- ===========================================
CREATE TABLE public.architecture_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES public.architecture_snapshots(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  feature_slug TEXT NOT NULL,
  feature_name TEXT NOT NULL,
  description TEXT,
  flow_json JSONB NOT NULL DEFAULT '[]', -- Array of flow steps
  screens TEXT[] DEFAULT '{}', -- Screen node IDs
  endpoints TEXT[] DEFAULT '{}', -- Endpoint node IDs
  tables TEXT[] DEFAULT '{}', -- Table node IDs
  services TEXT[] DEFAULT '{}', -- Service node IDs
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(snapshot_id, feature_slug)
);

CREATE INDEX architecture_features_snapshot_idx
  ON public.architecture_features (snapshot_id);

CREATE INDEX architecture_features_project_idx
  ON public.architecture_features (project_id);

ALTER TABLE public.architecture_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view architecture features"
  ON public.architecture_features FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project admins can create architecture features"
  ON public.architecture_features FOR INSERT
  WITH CHECK (public.is_project_admin(project_id));

CREATE POLICY "Project admins can delete architecture features"
  ON public.architecture_features FOR DELETE
  USING (public.is_project_admin(project_id));

-- ===========================================
-- HELPER FUNCTIONS
-- ===========================================

-- Get latest snapshot for a project
CREATE OR REPLACE FUNCTION public.get_latest_architecture_snapshot(p_project_id UUID)
RETURNS public.architecture_snapshots AS $$
  SELECT *
  FROM public.architecture_snapshots
  WHERE project_id = p_project_id
    AND status = 'completed'
  ORDER BY generated_at DESC
  LIMIT 1
$$ LANGUAGE sql SECURITY DEFINER;

-- Check if snapshot is stale (fingerprint mismatch)
CREATE OR REPLACE FUNCTION public.is_architecture_stale(
  p_project_id UUID,
  p_new_fingerprint TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_latest_fingerprint TEXT;
BEGIN
  SELECT source_fingerprint INTO v_latest_fingerprint
  FROM public.architecture_snapshots
  WHERE project_id = p_project_id
    AND status = 'completed'
  ORDER BY generated_at DESC
  LIMIT 1;

  IF v_latest_fingerprint IS NULL THEN
    RETURN true; -- No snapshot exists
  END IF;

  RETURN v_latest_fingerprint != p_new_fingerprint;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get evidence for a specific node
CREATE OR REPLACE FUNCTION public.get_node_evidence(
  p_snapshot_id UUID,
  p_node_id TEXT
)
RETURNS SETOF public.architecture_evidence AS $$
  SELECT *
  FROM public.architecture_evidence
  WHERE snapshot_id = p_snapshot_id
    AND node_id = p_node_id
  ORDER BY kind, file_path
$$ LANGUAGE sql SECURITY DEFINER;

-- Get evidence for a specific edge
CREATE OR REPLACE FUNCTION public.get_edge_evidence(
  p_snapshot_id UUID,
  p_edge_id TEXT
)
RETURNS SETOF public.architecture_evidence AS $$
  SELECT *
  FROM public.architecture_evidence
  WHERE snapshot_id = p_snapshot_id
    AND edge_id = p_edge_id
  ORDER BY kind, file_path
$$ LANGUAGE sql SECURITY DEFINER;
