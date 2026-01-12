-- ===========================================
-- PROJECT INVITATIONS
-- ===========================================
CREATE TYPE invitation_status AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

CREATE TABLE public.project_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  role project_role NOT NULL DEFAULT 'MEMBER',
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  accepted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status invitation_status DEFAULT 'PENDING',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,

  -- Constraint: role cannot be OWNER (only MAINTAINER or MEMBER)
  CONSTRAINT valid_invite_role CHECK (role IN ('MAINTAINER', 'MEMBER'))
);

-- Index for token lookups (most common query pattern)
CREATE INDEX project_invitations_token_idx ON public.project_invitations (token);

-- Index for listing invitations by project
CREATE INDEX project_invitations_project_idx ON public.project_invitations (project_id, status);

ALTER TABLE public.project_invitations ENABLE ROW LEVEL SECURITY;

-- ===========================================
-- RLS POLICIES
-- ===========================================

-- Project admins can view all invitations for their projects
CREATE POLICY "Project admins can view invitations"
  ON public.project_invitations FOR SELECT
  USING (public.is_project_admin(project_id));

-- Project admins can create invitations
CREATE POLICY "Project admins can create invitations"
  ON public.project_invitations FOR INSERT
  WITH CHECK (public.is_project_admin(project_id));

-- Project admins can update invitations (revoke)
CREATE POLICY "Project admins can update invitations"
  ON public.project_invitations FOR UPDATE
  USING (public.is_project_admin(project_id));

-- Project admins can delete invitations
CREATE POLICY "Project admins can delete invitations"
  ON public.project_invitations FOR DELETE
  USING (public.is_project_admin(project_id));

-- ===========================================
-- HELPER FUNCTION FOR TOKEN VALIDATION
-- ===========================================
CREATE OR REPLACE FUNCTION public.get_valid_invitation(p_token TEXT)
RETURNS TABLE (
  id UUID,
  project_id UUID,
  role project_role,
  project_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.id,
    i.project_id,
    i.role,
    p.name as project_name
  FROM public.project_invitations i
  JOIN public.projects p ON i.project_id = p.id
  WHERE i.token = p_token
    AND i.status = 'PENDING'
    AND i.expires_at > NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
