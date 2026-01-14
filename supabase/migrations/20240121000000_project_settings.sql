-- Add settings column to projects table for AI model configuration
ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{"ai_model": "gpt-4o"}'::jsonb;

-- Add comment describing the settings structure
COMMENT ON COLUMN public.projects.settings IS 'Project settings JSON. Keys: ai_model (gpt-4o, gpt-4o-mini, gpt-5, o1, o1-mini)';

-- Update existing projects to have default settings
UPDATE public.projects
SET settings = '{"ai_model": "gpt-4o"}'::jsonb
WHERE settings IS NULL;
