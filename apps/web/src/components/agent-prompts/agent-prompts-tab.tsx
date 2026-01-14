'use client'

import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Plus, GitBranch } from 'lucide-react'
import { RepoSession } from './repo-session'
import type { Repo, AgentPromptSession } from '@laneshare/shared'

interface AgentPromptsTabProps {
  taskId: string
  projectId: string
  repos: Array<{ id: string; owner: string; name: string }>
}

export function AgentPromptsTab({ taskId, projectId, repos }: AgentPromptsTabProps) {
  const { toast } = useToast()
  const [sessions, setSessions] = useState<AgentPromptSession[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [activeRepoId, setActiveRepoId] = useState<string | null>(null)

  // Load existing sessions
  useEffect(() => {
    loadSessions()
  }, [taskId, projectId])

  const loadSessions = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/tasks/${taskId}/agent-prompts`
      )
      if (response.ok) {
        const data = await response.json()
        setSessions(data)
        // Set active tab to first session's repo or first repo
        if (data.length > 0 && !activeRepoId) {
          setActiveRepoId(data[0].repo_id)
        } else if (repos.length > 0 && !activeRepoId) {
          setActiveRepoId(repos[0].id)
        }
      }
    } catch (error) {
      console.error('Failed to load sessions:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateSession = async (repoId: string) => {
    setIsCreating(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/tasks/${taskId}/agent-prompts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo_id: repoId }),
        }
      )

      if (response.ok) {
        const session = await response.json()
        setSessions((prev) => [...prev, session])
        toast({ title: 'Session created' })
      } else if (response.status === 409) {
        // Session already exists
        const data = await response.json()
        toast({ title: 'Session already exists for this repo' })
      } else {
        throw new Error('Failed to create session')
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to create session',
      })
    } finally {
      setIsCreating(false)
    }
  }

  const handleSessionUpdate = (updatedSession: AgentPromptSession) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
    )
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (repos.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        <GitBranch className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No repositories connected to this project.</p>
        <p className="mt-1">Connect a repository to generate AI agent prompts.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Tabs
        value={activeRepoId || repos[0]?.id}
        onValueChange={setActiveRepoId}
      >
        <TabsList className="w-full flex-wrap h-auto gap-1">
          {repos.map((repo) => {
            const hasSession = sessions.some((s) => s.repo_id === repo.id)
            return (
              <TabsTrigger
                key={repo.id}
                value={repo.id}
                className="flex items-center gap-1.5 text-xs"
              >
                <GitBranch className="h-3 w-3" />
                {repo.name}
                {hasSession && (
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                )}
              </TabsTrigger>
            )
          })}
        </TabsList>

        {repos.map((repo) => {
          const session = sessions.find((s) => s.repo_id === repo.id)

          return (
            <TabsContent key={repo.id} value={repo.id} className="mt-4">
              {session ? (
                <RepoSession
                  session={session}
                  repo={repo}
                  taskId={taskId}
                  projectId={projectId}
                  onSessionUpdate={handleSessionUpdate}
                />
              ) : (
                <div className="text-center py-8 border rounded-lg border-dashed">
                  <GitBranch className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground mb-4">
                    No prompt session for {repo.owner}/{repo.name}
                  </p>
                  <Button
                    onClick={() => handleCreateSession(repo.id)}
                    disabled={isCreating}
                  >
                    {isCreating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4 mr-2" />
                    )}
                    Start Session
                  </Button>
                </div>
              )}
            </TabsContent>
          )
        })}
      </Tabs>
    </div>
  )
}
