-- Add GitHub token storage to repos for Codespaces support
-- Each repo can have its own GitHub token for accessing the GitHub Codespaces API

ALTER TABLE public.repos
ADD COLUMN IF NOT EXISTS github_token_encrypted TEXT;

-- Add a comment for documentation
COMMENT ON COLUMN public.repos.github_token_encrypted IS 'Encrypted GitHub personal access token for Codespaces API access';
