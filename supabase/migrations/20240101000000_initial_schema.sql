-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable pgcrypto for encryption helpers
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===========================================
-- USERS PROFILE TABLE (extends Supabase Auth)
-- ===========================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  is_pro BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Function to create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===========================================
-- PROJECTS
-- ===========================================
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- ===========================================
-- PROJECT MEMBERS
-- ===========================================
CREATE TYPE project_role AS ENUM ('OWNER', 'MAINTAINER', 'MEMBER');

CREATE TABLE public.project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role project_role NOT NULL DEFAULT 'MEMBER',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

-- Helper function to check project membership
CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = p_project_id AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to check if user is project owner/maintainer
CREATE OR REPLACE FUNCTION public.is_project_admin(p_project_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = p_project_id
    AND user_id = auth.uid()
    AND role IN ('OWNER', 'MAINTAINER')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Project policies
CREATE POLICY "Project members can view projects"
  ON public.projects FOR SELECT
  USING (public.is_project_member(id));

CREATE POLICY "Users can create projects"
  ON public.projects FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Project admins can update projects"
  ON public.projects FOR UPDATE
  USING (public.is_project_admin(id));

CREATE POLICY "Project owners can delete projects"
  ON public.projects FOR DELETE
  USING (owner_id = auth.uid());

-- Project member policies
CREATE POLICY "Project members can view members"
  ON public.project_members FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project admins can add members"
  ON public.project_members FOR INSERT
  WITH CHECK (public.is_project_admin(project_id));

CREATE POLICY "Project admins can update members"
  ON public.project_members FOR UPDATE
  USING (public.is_project_admin(project_id));

CREATE POLICY "Project admins can remove members"
  ON public.project_members FOR DELETE
  USING (public.is_project_admin(project_id));

-- ===========================================
-- GITHUB CONNECTIONS
-- ===========================================
CREATE TABLE public.github_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'github',
  access_token_encrypted TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

ALTER TABLE public.github_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own connections"
  ON public.github_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own connections"
  ON public.github_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own connections"
  ON public.github_connections FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own connections"
  ON public.github_connections FOR DELETE
  USING (auth.uid() = user_id);

-- ===========================================
-- REPOSITORIES
-- ===========================================
CREATE TYPE repo_status AS ENUM ('PENDING', 'SYNCING', 'SYNCED', 'ERROR');

CREATE TABLE public.repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'github',
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  status repo_status DEFAULT 'PENDING',
  sync_error TEXT,
  UNIQUE(project_id, provider, owner, name)
);

ALTER TABLE public.repos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view repos"
  ON public.repos FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project admins can add repos"
  ON public.repos FOR INSERT
  WITH CHECK (public.is_project_admin(project_id));

CREATE POLICY "Project admins can update repos"
  ON public.repos FOR UPDATE
  USING (public.is_project_admin(project_id));

CREATE POLICY "Project admins can delete repos"
  ON public.repos FOR DELETE
  USING (public.is_project_admin(project_id));

-- ===========================================
-- REPO FILES
-- ===========================================
CREATE TABLE public.repo_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  sha TEXT NOT NULL,
  size INTEGER NOT NULL,
  language TEXT,
  last_indexed_at TIMESTAMPTZ,
  UNIQUE(repo_id, path)
);

ALTER TABLE public.repo_files ENABLE ROW LEVEL SECURITY;

-- Helper to check repo project membership
CREATE OR REPLACE FUNCTION public.is_repo_member(p_repo_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.repos r
    JOIN public.project_members pm ON r.project_id = pm.project_id
    WHERE r.id = p_repo_id AND pm.user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE POLICY "Project members can view repo files"
  ON public.repo_files FOR SELECT
  USING (public.is_repo_member(repo_id));

CREATE POLICY "System can manage repo files"
  ON public.repo_files FOR ALL
  USING (public.is_repo_member(repo_id));

-- ===========================================
-- CHUNKS (with pgvector embeddings)
-- ===========================================
CREATE TABLE public.chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  embedding vector(1536), -- OpenAI ada-002 dimension
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for vector similarity search
CREATE INDEX chunks_embedding_idx ON public.chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Create index for file path lookups
CREATE INDEX chunks_repo_file_idx ON public.chunks (repo_id, file_path);

ALTER TABLE public.chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view chunks"
  ON public.chunks FOR SELECT
  USING (public.is_repo_member(repo_id));

CREATE POLICY "System can manage chunks"
  ON public.chunks FOR ALL
  USING (public.is_repo_member(repo_id));

-- ===========================================
-- SPRINTS
-- ===========================================
CREATE TABLE public.sprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.sprints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view sprints"
  ON public.sprints FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project admins can manage sprints"
  ON public.sprints FOR ALL
  USING (public.is_project_admin(project_id));

-- ===========================================
-- TASKS
-- ===========================================
CREATE TYPE task_status AS ENUM ('BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE');
CREATE TYPE task_priority AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status task_status DEFAULT 'BACKLOG',
  assignee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  repo_scope TEXT[], -- Array of repo names
  priority task_priority DEFAULT 'MEDIUM',
  sprint_id UUID REFERENCES public.sprints(id) ON DELETE SET NULL,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX tasks_project_status_idx ON public.tasks (project_id, status);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view tasks"
  ON public.tasks FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create tasks"
  ON public.tasks FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY "Project members can update tasks"
  ON public.tasks FOR UPDATE
  USING (public.is_project_member(project_id));

CREATE POLICY "Project admins can delete tasks"
  ON public.tasks FOR DELETE
  USING (public.is_project_admin(project_id));

-- ===========================================
-- TASK UPDATES (for agent summaries)
-- ===========================================
CREATE TABLE public.task_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user', -- 'user' or 'agent_summary'
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.task_updates ENABLE ROW LEVEL SECURITY;

-- Helper to check task project membership
CREATE OR REPLACE FUNCTION public.is_task_member(p_task_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.tasks t
    JOIN public.project_members pm ON t.project_id = pm.project_id
    WHERE t.id = p_task_id AND pm.user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE POLICY "Project members can view task updates"
  ON public.task_updates FOR SELECT
  USING (public.is_task_member(task_id));

CREATE POLICY "Project members can create task updates"
  ON public.task_updates FOR INSERT
  WITH CHECK (public.is_task_member(task_id));

-- ===========================================
-- CHAT THREADS
-- ===========================================
CREATE TABLE public.chat_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New Chat',
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view chat threads"
  ON public.chat_threads FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create chat threads"
  ON public.chat_threads FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY "Thread creators can update their threads"
  ON public.chat_threads FOR UPDATE
  USING (created_by = auth.uid());

CREATE POLICY "Thread creators can delete their threads"
  ON public.chat_threads FOR DELETE
  USING (created_by = auth.uid());

-- ===========================================
-- CHAT MESSAGES
-- ===========================================
CREATE TYPE chat_sender AS ENUM ('USER', 'LANEPILOT');

CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  sender chat_sender NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX chat_messages_thread_idx ON public.chat_messages (thread_id, created_at);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Helper to check thread project membership
CREATE OR REPLACE FUNCTION public.is_thread_member(p_thread_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.chat_threads ct
    JOIN public.project_members pm ON ct.project_id = pm.project_id
    WHERE ct.id = p_thread_id AND pm.user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE POLICY "Project members can view chat messages"
  ON public.chat_messages FOR SELECT
  USING (public.is_thread_member(thread_id));

CREATE POLICY "Project members can create chat messages"
  ON public.chat_messages FOR INSERT
  WITH CHECK (public.is_thread_member(thread_id));

-- ===========================================
-- PROMPT ARTIFACTS
-- ===========================================
CREATE TYPE artifact_kind AS ENUM ('CONTEXT_PACK', 'AGENT_PROMPT', 'DOC_UPDATE');

CREATE TABLE public.prompt_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  thread_id UUID REFERENCES public.chat_threads(id) ON DELETE SET NULL,
  kind artifact_kind NOT NULL,
  content TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.prompt_artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view artifacts"
  ON public.prompt_artifacts FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create artifacts"
  ON public.prompt_artifacts FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

-- ===========================================
-- DOC PAGES
-- ===========================================
CREATE TYPE doc_category AS ENUM ('architecture', 'features', 'decisions', 'status');

CREATE TABLE public.doc_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  markdown TEXT NOT NULL DEFAULT '',
  category doc_category NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, slug)
);

CREATE INDEX doc_pages_project_category_idx ON public.doc_pages (project_id, category);

ALTER TABLE public.doc_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view doc pages"
  ON public.doc_pages FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create doc pages"
  ON public.doc_pages FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

CREATE POLICY "Project members can update doc pages"
  ON public.doc_pages FOR UPDATE
  USING (public.is_project_member(project_id));

CREATE POLICY "Project admins can delete doc pages"
  ON public.doc_pages FOR DELETE
  USING (public.is_project_admin(project_id));

-- ===========================================
-- DECISION LOG
-- ===========================================
CREATE TABLE public.decision_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  context TEXT NOT NULL,
  decision TEXT NOT NULL,
  consequences TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.decision_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view decision logs"
  ON public.decision_logs FOR SELECT
  USING (public.is_project_member(project_id));

CREATE POLICY "Project members can create decision logs"
  ON public.decision_logs FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

-- ===========================================
-- VECTOR SEARCH FUNCTION
-- ===========================================
CREATE OR REPLACE FUNCTION public.search_chunks(
  p_project_id UUID,
  p_query_embedding vector(1536),
  p_match_count INTEGER DEFAULT 10,
  p_match_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  id UUID,
  repo_id UUID,
  file_path TEXT,
  content TEXT,
  chunk_index INTEGER,
  similarity FLOAT,
  repo_owner TEXT,
  repo_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.repo_id,
    c.file_path,
    c.content,
    c.chunk_index,
    1 - (c.embedding <=> p_query_embedding) as similarity,
    r.owner as repo_owner,
    r.name as repo_name
  FROM public.chunks c
  JOIN public.repos r ON c.repo_id = r.id
  WHERE r.project_id = p_project_id
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> p_query_embedding) > p_match_threshold
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_match_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- KEYWORD SEARCH FUNCTION
-- ===========================================
CREATE OR REPLACE FUNCTION public.keyword_search_chunks(
  p_project_id UUID,
  p_query TEXT,
  p_match_count INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  repo_id UUID,
  file_path TEXT,
  content TEXT,
  chunk_index INTEGER,
  repo_owner TEXT,
  repo_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.repo_id,
    c.file_path,
    c.content,
    c.chunk_index,
    r.owner as repo_owner,
    r.name as repo_name
  FROM public.chunks c
  JOIN public.repos r ON c.repo_id = r.id
  WHERE r.project_id = p_project_id
    AND c.content ILIKE '%' || p_query || '%'
  LIMIT p_match_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- UPDATE TIMESTAMP TRIGGERS
-- ===========================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_chat_threads_updated_at
  BEFORE UPDATE ON public.chat_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_doc_pages_updated_at
  BEFORE UPDATE ON public.doc_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_github_connections_updated_at
  BEFORE UPDATE ON public.github_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
