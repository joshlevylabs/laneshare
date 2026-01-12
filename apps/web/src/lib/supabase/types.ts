export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          avatar_url: string | null
          is_pro: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          avatar_url?: string | null
          is_pro?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          avatar_url?: string | null
          is_pro?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      projects: {
        Row: {
          id: string
          owner_id: string
          name: string
          description: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          owner_id: string
          name: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          name?: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      project_members: {
        Row: {
          id: string
          project_id: string
          user_id: string
          role: 'OWNER' | 'MAINTAINER' | 'MEMBER'
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          user_id: string
          role?: 'OWNER' | 'MAINTAINER' | 'MEMBER'
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          user_id?: string
          role?: 'OWNER' | 'MAINTAINER' | 'MEMBER'
          created_at?: string
        }
      }
      github_connections: {
        Row: {
          id: string
          user_id: string
          provider: string
          access_token_encrypted: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          provider?: string
          access_token_encrypted: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          provider?: string
          access_token_encrypted?: string
          created_at?: string
          updated_at?: string
        }
      }
      repos: {
        Row: {
          id: string
          project_id: string
          provider: string
          owner: string
          name: string
          default_branch: string
          installed_at: string
          last_synced_at: string | null
          status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR'
          sync_error: string | null
        }
        Insert: {
          id?: string
          project_id: string
          provider?: string
          owner: string
          name: string
          default_branch?: string
          installed_at?: string
          last_synced_at?: string | null
          status?: 'PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR'
          sync_error?: string | null
        }
        Update: {
          id?: string
          project_id?: string
          provider?: string
          owner?: string
          name?: string
          default_branch?: string
          installed_at?: string
          last_synced_at?: string | null
          status?: 'PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR'
          sync_error?: string | null
        }
      }
      repo_files: {
        Row: {
          id: string
          repo_id: string
          path: string
          sha: string
          size: number
          language: string | null
          last_indexed_at: string | null
        }
        Insert: {
          id?: string
          repo_id: string
          path: string
          sha: string
          size: number
          language?: string | null
          last_indexed_at?: string | null
        }
        Update: {
          id?: string
          repo_id?: string
          path?: string
          sha?: string
          size?: number
          language?: string | null
          last_indexed_at?: string | null
        }
      }
      chunks: {
        Row: {
          id: string
          repo_id: string
          file_path: string
          chunk_index: number
          content: string
          token_count: number
          embedding: number[] | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          repo_id: string
          file_path: string
          chunk_index: number
          content: string
          token_count: number
          embedding?: number[] | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          repo_id?: string
          file_path?: string
          chunk_index?: number
          content?: string
          token_count?: number
          embedding?: number[] | null
          metadata?: Json
          created_at?: string
        }
      }
      sprints: {
        Row: {
          id: string
          project_id: string
          name: string
          start_date: string | null
          end_date: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          name: string
          start_date?: string | null
          end_date?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          name?: string
          start_date?: string | null
          end_date?: string | null
          created_at?: string
        }
      }
      tasks: {
        Row: {
          id: string
          project_id: string
          title: string
          description: string | null
          status: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE'
          assignee_id: string | null
          repo_scope: string[] | null
          priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
          sprint_id: string | null
          position: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          title: string
          description?: string | null
          status?: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE'
          assignee_id?: string | null
          repo_scope?: string[] | null
          priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
          sprint_id?: string | null
          position?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          title?: string
          description?: string | null
          status?: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE'
          assignee_id?: string | null
          repo_scope?: string[] | null
          priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
          sprint_id?: string | null
          position?: number
          created_at?: string
          updated_at?: string
        }
      }
      task_updates: {
        Row: {
          id: string
          task_id: string
          content: string
          source: string
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          task_id: string
          content: string
          source?: string
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          task_id?: string
          content?: string
          source?: string
          created_by?: string | null
          created_at?: string
        }
      }
      chat_threads: {
        Row: {
          id: string
          project_id: string
          created_by: string
          title: string
          task_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          created_by: string
          title?: string
          task_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          created_by?: string
          title?: string
          task_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      chat_messages: {
        Row: {
          id: string
          thread_id: string
          sender: 'USER' | 'LANEPILOT'
          content: string
          created_at: string
        }
        Insert: {
          id?: string
          thread_id: string
          sender: 'USER' | 'LANEPILOT'
          content: string
          created_at?: string
        }
        Update: {
          id?: string
          thread_id?: string
          sender?: 'USER' | 'LANEPILOT'
          content?: string
          created_at?: string
        }
      }
      prompt_artifacts: {
        Row: {
          id: string
          project_id: string
          task_id: string | null
          thread_id: string | null
          kind: 'CONTEXT_PACK' | 'AGENT_PROMPT' | 'DOC_UPDATE'
          content: string
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          task_id?: string | null
          thread_id?: string | null
          kind: 'CONTEXT_PACK' | 'AGENT_PROMPT' | 'DOC_UPDATE'
          content: string
          created_by: string
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          task_id?: string | null
          thread_id?: string | null
          kind?: 'CONTEXT_PACK' | 'AGENT_PROMPT' | 'DOC_UPDATE'
          content?: string
          created_by?: string
          created_at?: string
        }
      }
      doc_pages: {
        Row: {
          id: string
          project_id: string
          slug: string
          title: string
          markdown: string
          category: 'architecture' | 'features' | 'decisions' | 'status'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          slug: string
          title: string
          markdown?: string
          category: 'architecture' | 'features' | 'decisions' | 'status'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          slug?: string
          title?: string
          markdown?: string
          category?: 'architecture' | 'features' | 'decisions' | 'status'
          created_at?: string
          updated_at?: string
        }
      }
      decision_logs: {
        Row: {
          id: string
          project_id: string
          title: string
          context: string
          decision: string
          consequences: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          title: string
          context: string
          decision: string
          consequences?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          title?: string
          context?: string
          decision?: string
          consequences?: string | null
          created_by?: string | null
          created_at?: string
        }
      }
    }
    Functions: {
      is_project_member: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      is_project_admin: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      search_chunks: {
        Args: {
          p_project_id: string
          p_query_embedding: number[]
          p_match_count?: number
          p_match_threshold?: number
        }
        Returns: {
          id: string
          repo_id: string
          file_path: string
          content: string
          chunk_index: number
          similarity: number
          repo_owner: string
          repo_name: string
        }[]
      }
      keyword_search_chunks: {
        Args: {
          p_project_id: string
          p_query: string
          p_match_count?: number
        }
        Returns: {
          id: string
          repo_id: string
          file_path: string
          content: string
          chunk_index: number
          repo_owner: string
          repo_name: string
        }[]
      }
    }
  }
}
