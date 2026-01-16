-- Add devcontainer_configured column to repos table
-- Tracks whether the repository has been set up with LaneShare devcontainer configuration

ALTER TABLE public.repos
ADD COLUMN IF NOT EXISTS devcontainer_configured BOOLEAN DEFAULT false;

-- Add comment
COMMENT ON COLUMN public.repos.devcontainer_configured IS 'Whether the repo has LaneShare devcontainer.json configured for ttyd and Claude Code';
