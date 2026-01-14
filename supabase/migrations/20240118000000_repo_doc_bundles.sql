-- Migration: Add repo documentation bundle tables for Claude Code wrapper
-- This supports auto-generated, versioned documentation for connected GitHub repositories

-- Create enum for doc bundle status
CREATE TYPE public.repo_doc_status AS ENUM (
  'PENDING',
  'GENERATING',
  'READY',
  'NEEDS_REVIEW',
  'ERROR'
);

-- Create enum for doc page categories
CREATE TYPE public.repo_doc_category AS ENUM (
  'ARCHITECTURE',
  'API',
  'FEATURE',
  'RUNBOOK'
);

-- Create repo_doc_bundle table (versioned documentation bundles per repo)
CREATE TABLE public.repo_doc_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  status public.repo_doc_status NOT NULL DEFAULT 'PENDING',
  generated_at TIMESTAMPTZ,
  generated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  source_fingerprint TEXT, -- hash of repo default_branch + head sha + key config file shas
  summary_json JSONB DEFAULT '{}'::jsonb, -- counts, coverage, warnings
  error TEXT,
  raw_output TEXT, -- raw Claude Code output for debugging (server-side only)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(repo_id, version)
);

-- Create repo_doc_pages table (individual doc pages with evidence)
CREATE TABLE public.repo_doc_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id UUID NOT NULL REFERENCES public.repo_doc_bundles(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,
  category public.repo_doc_category NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  markdown TEXT NOT NULL,
  evidence_json JSONB DEFAULT '[]'::jsonb, -- list of {file_path, excerpt, reason}
  needs_review BOOLEAN NOT NULL DEFAULT false,
  user_edited BOOLEAN NOT NULL DEFAULT false,
  user_edited_at TIMESTAMPTZ,
  user_edited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(bundle_id, slug)
);

-- Create repo_doc_tasks table (follow-up tasks from Claude Code)
CREATE TABLE public.repo_doc_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id UUID NOT NULL REFERENCES public.repo_doc_bundles(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category public.repo_doc_category,
  priority TEXT DEFAULT 'medium', -- low, medium, high
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add doc_status column to repos table for quick status display
ALTER TABLE public.repos
ADD COLUMN IF NOT EXISTS doc_status public.repo_doc_status DEFAULT NULL,
ADD COLUMN IF NOT EXISTS doc_bundle_id UUID REFERENCES public.repo_doc_bundles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS auto_generate_docs BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.repos.doc_status IS 'Current documentation status for quick display';
COMMENT ON COLUMN public.repos.doc_bundle_id IS 'Reference to latest doc bundle';
COMMENT ON COLUMN public.repos.auto_generate_docs IS 'Whether to auto-generate docs on repo sync';

-- Create indexes for efficient queries
CREATE INDEX idx_repo_doc_bundles_repo_id ON public.repo_doc_bundles(repo_id);
CREATE INDEX idx_repo_doc_bundles_project_id ON public.repo_doc_bundles(project_id);
CREATE INDEX idx_repo_doc_bundles_status ON public.repo_doc_bundles(status);
CREATE INDEX idx_repo_doc_pages_bundle_id ON public.repo_doc_pages(bundle_id);
CREATE INDEX idx_repo_doc_pages_repo_id ON public.repo_doc_pages(repo_id);
CREATE INDEX idx_repo_doc_pages_category ON public.repo_doc_pages(category);
CREATE INDEX idx_repo_doc_pages_slug ON public.repo_doc_pages(slug);
CREATE INDEX idx_repo_doc_tasks_bundle_id ON public.repo_doc_tasks(bundle_id);

-- Enable RLS
ALTER TABLE public.repo_doc_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repo_doc_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repo_doc_tasks ENABLE ROW LEVEL SECURITY;

-- RLS Policies for repo_doc_bundles
CREATE POLICY "Project members can view doc bundles"
  ON public.repo_doc_bundles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = repo_doc_bundles.project_id
      AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Maintainers can create doc bundles"
  ON public.repo_doc_bundles FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = repo_doc_bundles.project_id
      AND pm.user_id = auth.uid()
      AND pm.role IN ('OWNER', 'MAINTAINER')
    )
  );

CREATE POLICY "Maintainers can update doc bundles"
  ON public.repo_doc_bundles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = repo_doc_bundles.project_id
      AND pm.user_id = auth.uid()
      AND pm.role IN ('OWNER', 'MAINTAINER')
    )
  );

-- RLS Policies for repo_doc_pages
CREATE POLICY "Project members can view doc pages"
  ON public.repo_doc_pages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = repo_doc_pages.project_id
      AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Maintainers can create doc pages"
  ON public.repo_doc_pages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = repo_doc_pages.project_id
      AND pm.user_id = auth.uid()
      AND pm.role IN ('OWNER', 'MAINTAINER')
    )
  );

CREATE POLICY "Members can update doc pages (for edits)"
  ON public.repo_doc_pages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = repo_doc_pages.project_id
      AND pm.user_id = auth.uid()
    )
  );

-- RLS Policies for repo_doc_tasks
CREATE POLICY "Project members can view doc tasks"
  ON public.repo_doc_tasks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = repo_doc_tasks.project_id
      AND pm.user_id = auth.uid()
    )
  );

CREATE POLICY "Maintainers can manage doc tasks"
  ON public.repo_doc_tasks FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = repo_doc_tasks.project_id
      AND pm.user_id = auth.uid()
      AND pm.role IN ('OWNER', 'MAINTAINER')
    )
  );

-- Trigger to update updated_at on bundles
CREATE OR REPLACE FUNCTION public.update_repo_doc_bundle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_repo_doc_bundle_updated_at
  BEFORE UPDATE ON public.repo_doc_bundles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_repo_doc_bundle_updated_at();

-- Trigger to update updated_at on pages
CREATE OR REPLACE FUNCTION public.update_repo_doc_page_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_repo_doc_page_updated_at
  BEFORE UPDATE ON public.repo_doc_pages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_repo_doc_page_updated_at();

-- Add service role access for server-side operations
CREATE POLICY "Service role full access to doc bundles"
  ON public.repo_doc_bundles FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access to doc pages"
  ON public.repo_doc_pages FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access to doc tasks"
  ON public.repo_doc_tasks FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
