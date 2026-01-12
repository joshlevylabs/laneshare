-- ===========================================
-- CONNECTED SERVICES FEATURE
-- ===========================================

-- ===========================================
-- SERVICE CONNECTION STATUS ENUM
-- ===========================================
CREATE TYPE service_connection_status AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR');

-- ===========================================
-- SERVICE SYNC RUN STATUS ENUM
-- ===========================================
CREATE TYPE service_sync_status AS ENUM ('RUNNING', 'SUCCESS', 'ERROR');

-- ===========================================
-- PROJECT SERVICE CONNECTION
-- Stores connections to external services (Supabase, Vercel, etc.)
-- ===========================================
CREATE TABLE public.project_service_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  service TEXT NOT NULL, -- 'supabase' | 'vercel' (extensible)
  display_name TEXT NOT NULL,
  status service_connection_status DEFAULT 'DISCONNECTED',
  config_json JSONB NOT NULL DEFAULT '{}', -- non-secret config (supabase_url, vercel_team_id, etc.)
  secret_encrypted TEXT NOT NULL, -- encrypted JSON blob for secrets
  last_synced_at TIMESTAMPTZ,
  last_sync_error TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Only one connection per service per project
  UNIQUE(project_id, service)
);

-- Create index for project lookups
CREATE INDEX project_service_connections_project_idx ON public.project_service_connections (project_id);

ALTER TABLE public.project_service_connections ENABLE ROW LEVEL SECURITY;

-- ===========================================
-- SERVICE ASSET
-- Stores metadata about discovered service assets (tables, deployments, etc.)
-- ===========================================
CREATE TABLE public.service_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.project_service_connections(id) ON DELETE CASCADE,
  service TEXT NOT NULL, -- 'supabase' | 'vercel'
  asset_type TEXT NOT NULL, -- 'table'|'column'|'policy'|'function'|'trigger'|'bucket'|'auth_provider'|'vercel_project'|'deployment'|'domain'|'env_var'
  asset_key TEXT NOT NULL, -- stable unique key, e.g. 'public.users' or 'vercel:proj_abc'
  name TEXT NOT NULL,
  data_json JSONB NOT NULL DEFAULT '{}', -- full metadata payload
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique asset per connection
  UNIQUE(connection_id, asset_key)
);

-- Create indexes for lookups
CREATE INDEX service_assets_project_idx ON public.service_assets (project_id);
CREATE INDEX service_assets_connection_idx ON public.service_assets (connection_id);
CREATE INDEX service_assets_type_idx ON public.service_assets (connection_id, asset_type);

ALTER TABLE public.service_assets ENABLE ROW LEVEL SECURITY;

-- ===========================================
-- SERVICE SYNC RUN
-- Tracks sync operations for auditing and debugging
-- ===========================================
CREATE TABLE public.service_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.project_service_connections(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status service_sync_status DEFAULT 'RUNNING',
  stats_json JSONB DEFAULT '{}', -- { tables: 5, columns: 20, policies: 10, ... }
  error TEXT,
  triggered_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for lookups
CREATE INDEX service_sync_runs_project_idx ON public.service_sync_runs (project_id);
CREATE INDEX service_sync_runs_connection_idx ON public.service_sync_runs (connection_id, started_at DESC);

ALTER TABLE public.service_sync_runs ENABLE ROW LEVEL SECURITY;

-- ===========================================
-- RLS POLICIES FOR project_service_connections
-- ===========================================

-- Project members can view service connections
CREATE POLICY "Project members can view service connections"
  ON public.project_service_connections FOR SELECT
  USING (public.is_project_member(project_id));

-- Only project admins (OWNER/MAINTAINER) can create connections
CREATE POLICY "Project admins can create service connections"
  ON public.project_service_connections FOR INSERT
  WITH CHECK (public.is_project_admin(project_id));

-- Only project admins can update connections
CREATE POLICY "Project admins can update service connections"
  ON public.project_service_connections FOR UPDATE
  USING (public.is_project_admin(project_id));

-- Only project admins can delete connections
CREATE POLICY "Project admins can delete service connections"
  ON public.project_service_connections FOR DELETE
  USING (public.is_project_admin(project_id));

-- ===========================================
-- RLS POLICIES FOR service_assets
-- ===========================================

-- Project members can view service assets
CREATE POLICY "Project members can view service assets"
  ON public.service_assets FOR SELECT
  USING (public.is_project_member(project_id));

-- Only project admins can manage assets (via sync)
CREATE POLICY "Project admins can manage service assets"
  ON public.service_assets FOR ALL
  USING (public.is_project_admin(project_id));

-- ===========================================
-- RLS POLICIES FOR service_sync_runs
-- ===========================================

-- Project members can view sync runs
CREATE POLICY "Project members can view service sync runs"
  ON public.service_sync_runs FOR SELECT
  USING (public.is_project_member(project_id));

-- Only project admins can create sync runs (trigger syncs)
CREATE POLICY "Project admins can create service sync runs"
  ON public.service_sync_runs FOR INSERT
  WITH CHECK (public.is_project_admin(project_id));

-- Only project admins can update sync runs (complete syncs)
CREATE POLICY "Project admins can update service sync runs"
  ON public.service_sync_runs FOR UPDATE
  USING (public.is_project_admin(project_id));

-- ===========================================
-- HELPER FUNCTION: Check if user can manage service for a project
-- ===========================================
CREATE OR REPLACE FUNCTION public.is_service_connection_admin(p_connection_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.project_service_connections sc
    JOIN public.project_members pm ON sc.project_id = pm.project_id
    WHERE sc.id = p_connection_id
    AND pm.user_id = auth.uid()
    AND pm.role IN ('OWNER', 'MAINTAINER')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- TIMESTAMP TRIGGERS
-- ===========================================
CREATE TRIGGER update_project_service_connections_updated_at
  BEFORE UPDATE ON public.project_service_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ===========================================
-- ADD last_map_regen_at to projects (for debouncing)
-- ===========================================
ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS last_map_regen_at TIMESTAMPTZ;

-- ===========================================
-- UPDATE doc_category ENUM to include 'services' category
-- (Postgres doesn't support adding values to enums in transactions easily,
--  so we use a workaround or skip if already exists)
-- ===========================================

-- Safe way to add new enum value if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'services'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'doc_category')
  ) THEN
    ALTER TYPE doc_category ADD VALUE 'services';
  END IF;
END$$;
