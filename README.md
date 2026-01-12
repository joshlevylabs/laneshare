# LaneShare

LaneShare is a web application that enables vibe-coding collaboration across multiple GitHub repositories and multiple programmers, with an AI assistant ("LanePilot") that generates context-packed coding prompts for external coding agents (Cursor, Claude Code, etc.) and continuously generates/updates project documentation in Markdown.

## Features

- **Multi-repo Collaboration**: Connect multiple GitHub repositories to a single project
- **AI-Powered Context Packs**: LanePilot analyzes your codebase and generates structured prompts for coding agents
- **Semantic Code Search**: Search across all connected repos using vector similarity (pgvector) or keyword matching
- **Task Management**: Kanban-style task board with drag-and-drop
- **Auto Documentation**: AI-assisted documentation that updates based on implementation summaries
- **Team Collaboration**: Invite team members with role-based permissions

## Tech Stack

- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Next.js API Routes
- **Database**: Supabase (PostgreSQL + Auth + RLS)
- **Vector Search**: pgvector extension
- **AI**: OpenAI GPT-4 for LanePilot, text-embedding-ada-002 for embeddings
- **Encryption**: libsodium for token encryption

## Project Structure

```
/laneshare
├── apps/
│   └── web/                 # Next.js application
│       ├── src/
│       │   ├── app/         # App router pages and API routes
│       │   ├── components/  # React components
│       │   └── lib/         # Utilities (supabase, encryption, etc.)
│       └── ...
├── packages/
│   ├── shared/              # Shared types, utils, prompt templates
│   └── worker/              # Background worker (optional)
├── supabase/
│   └── migrations/          # SQL migrations
└── docs/                    # Developer documentation
```

## Prerequisites

- Node.js 18+
- npm 9+
- Supabase account (or local Supabase via Docker)
- GitHub Personal Access Token
- OpenAI API key

## Setup

### 1. Clone and Install

```bash
git clone <repository-url>
cd laneshare
npm install
```

### 2. Environment Variables

Create `.env.local` in `apps/web/`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Encryption (generate with: openssl rand -base64 32)
ENCRYPTION_KEY=your-32-byte-base64-key

# GitHub OAuth (optional - for OAuth flow)
GITHUB_OAUTH_CLIENT_ID=your-client-id
GITHUB_OAUTH_CLIENT_SECRET=your-client-secret

# OpenAI
EMBEDDINGS_PROVIDER=openai
OPENAI_API_KEY=your-openai-api-key
```

### 3. Database Setup

#### Option A: Supabase Cloud

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Enable the `vector` extension in SQL Editor:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. Run the migration file in `supabase/migrations/20240101000000_initial_schema.sql`
4. Copy your project URL and keys to `.env.local`

#### Option B: Local Supabase

```bash
# Install Supabase CLI
npm install -g supabase

# Start local Supabase
cd supabase
supabase start

# Run migrations
supabase db push
```

### 4. Generate Encryption Key

```bash
# Generate a 32-byte base64-encoded key
openssl rand -base64 32
```

Copy the output to `ENCRYPTION_KEY` in your `.env.local`.

### 5. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

### 1. Create an Account

Sign up with email/password or GitHub OAuth.

### 2. Create a Project

Click "New Project" to create your first project.

### 3. Connect GitHub

1. Go to Project → Repositories
2. Click "Connect GitHub"
3. Enter a GitHub Personal Access Token (PAT) with `repo` scope
4. Create a PAT at: https://github.com/settings/tokens/new

### 4. Add Repositories

1. Click "Add Repository"
2. Search and select from your GitHub repos
3. Click "Sync Now" to index the repository

### 5. Use LanePilot

1. Go to Project → LanePilot Chat
2. Optionally select a task for context
3. Describe what you want to implement
4. LanePilot will generate:
   - Context Pack (relevant code snippets)
   - Agent Prompts (copy-paste for Cursor/Claude Code)
   - Verification Checklist
   - Documentation Updates

### 6. Search Code

Use the Search page for:
- **Semantic Search**: Find conceptually related code
- **Keyword Search**: Find exact matches

### 7. Manage Tasks

Use the Task Board to:
- Create tasks with descriptions
- Assign to team members
- Track progress with drag-and-drop Kanban

### 8. Documentation

- Auto-created documentation pages for Architecture, Features, Decisions, Status
- Edit pages in the built-in Markdown editor
- AI can suggest documentation updates based on implementation summaries

## API Endpoints

### Projects
- `GET /api/projects` - List user's projects
- `POST /api/projects` - Create project
- `GET /api/projects/:id` - Get project
- `PATCH /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project

### Members
- `GET /api/projects/:id/members` - List members
- `POST /api/projects/:id/members` - Add member
- `PATCH /api/projects/:id/members/:memberId` - Update role
- `DELETE /api/projects/:id/members/:memberId` - Remove member

### Repositories
- `GET /api/projects/:id/repos` - List repos
- `POST /api/projects/:id/repos` - Add repo
- `POST /api/repos/:id/sync` - Sync repo
- `DELETE /api/repos/:id` - Remove repo

### Tasks
- `GET /api/projects/:id/tasks` - List tasks
- `POST /api/projects/:id/tasks` - Create task
- `PATCH /api/projects/:id/tasks/:taskId` - Update task
- `DELETE /api/projects/:id/tasks/:taskId` - Delete task

### Chat
- `GET /api/projects/:id/chat/threads` - List threads
- `POST /api/projects/:id/chat/threads` - Create thread
- `GET /api/projects/:id/chat/threads/:threadId/messages` - Get messages
- `POST /api/projects/:id/chat/threads/:threadId/messages` - Send message (triggers LanePilot)

### Search
- `POST /api/projects/:id/search` - Search chunks

### Documentation
- `GET /api/projects/:id/docs` - List docs
- `POST /api/projects/:id/docs` - Create doc
- `PATCH /api/projects/:id/docs/:docId` - Update doc
- `DELETE /api/projects/:id/docs/:docId` - Delete doc

## Security

- **RLS**: All database tables use Row Level Security
- **Encryption**: GitHub tokens are encrypted at rest using AES-GCM (libsodium)
- **Authentication**: Supabase Auth with email/password and GitHub OAuth

## Environment Variables Reference

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server only) | Yes |
| `ENCRYPTION_KEY` | 32-byte base64 key for token encryption | Yes |
| `OPENAI_API_KEY` | OpenAI API key for embeddings and LanePilot | Yes |
| `EMBEDDINGS_PROVIDER` | Embedding provider (default: `openai`) | No |
| `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth app client ID | No |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth app client secret | No |

## Development

### Running Tests

```bash
npm run test
```

### Building for Production

```bash
npm run build
```

### Database Migrations

```bash
cd supabase
supabase db push
```

## Deployment

### Vercel (Recommended)

1. Connect your repository to Vercel
2. Set environment variables in Vercel dashboard
3. Deploy

### Docker

```dockerfile
# Dockerfile example
FROM node:18-alpine
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
CMD ["npm", "start"]
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see LICENSE file for details.
