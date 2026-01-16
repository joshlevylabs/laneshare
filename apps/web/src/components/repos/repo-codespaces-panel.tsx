'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useToast } from '@/hooks/use-toast'
import type { Repo } from './repo-card'
import {
  Loader2,
  Key,
  ExternalLink,
  CheckCircle,
  AlertTriangle,
  Trash2,
  Cloud,
  Copy,
  Play,
  StopCircle,
  Rocket,
  Settings,
  Wand2,
  FileCode,
  ArrowRight,
} from 'lucide-react'

interface GitHubCodespace {
  id: number
  name: string
  state: 'Available' | 'Shutdown' | 'Starting' | 'Stopping' | 'Rebuilding' | 'Queued'
  repository: {
    full_name: string
  }
  machine?: {
    display_name: string
    cpus: number
    memory_in_bytes: number
  }
  web_url: string
  git_status?: {
    uncommitted_changes_count?: number
    unpushed_commits_count?: number
  }
}

interface RepoCodespacesPanelProps {
  repo: Repo
  projectId: string
  onTokenUpdated: () => void
}

export function RepoCodespacesPanel({ repo, projectId, onTokenUpdated }: RepoCodespacesPanelProps) {
  const { toast } = useToast()
  const router = useRouter()

  // Token state
  const [token, setToken] = useState('')
  const [isLoadingToken, setIsLoadingToken] = useState(false)
  const [isRemovingToken, setIsRemovingToken] = useState(false)
  const [tokenError, setTokenError] = useState('')

  // Devcontainer state
  const [isSettingUpDevcontainer, setIsSettingUpDevcontainer] = useState(false)
  const [devcontainerStatus, setDevcontainerStatus] = useState<{
    hasDevcontainer: boolean
    hasLaneshareConfig: boolean
    hasTtyd?: boolean
    hasClaudeCode?: boolean
  } | null>(null)
  const [isCheckingDevcontainer, setIsCheckingDevcontainer] = useState(false)

  // Codespaces state
  const [codespaces, setCodespaces] = useState<GitHubCodespace[]>([])
  const [isLoadingCodespaces, setIsLoadingCodespaces] = useState(false)
  const [startingCodespace, setStartingCodespace] = useState<string | null>(null)
  const [stoppingCodespace, setStoppingCodespace] = useState<string | null>(null)

  const [copied, setCopied] = useState(false)

  // Check devcontainer status on mount if token exists
  useEffect(() => {
    if (repo.has_codespaces_token) {
      checkDevcontainerStatus()
      fetchCodespaces()
    }
  }, [repo.has_codespaces_token, repo.id])

  const checkDevcontainerStatus = async () => {
    setIsCheckingDevcontainer(true)
    try {
      const response = await fetch(`/api/repos/${repo.id}/setup-devcontainer`)
      if (response.ok) {
        const data = await response.json()
        setDevcontainerStatus(data)
      }
    } catch (error) {
      console.error('Failed to check devcontainer status:', error)
    } finally {
      setIsCheckingDevcontainer(false)
    }
  }

  const fetchCodespaces = async () => {
    setIsLoadingCodespaces(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/codespaces`)
      if (response.ok) {
        const data = await response.json()
        // Filter to this repo's codespaces
        const repoFullName = `${repo.owner}/${repo.name}`
        const filtered = data.codespaces?.filter(
          (cs: GitHubCodespace) => cs.repository.full_name === repoFullName
        ) || []
        setCodespaces(filtered)
      }
    } catch (error) {
      console.error('Failed to fetch codespaces:', error)
    } finally {
      setIsLoadingCodespaces(false)
    }
  }

  const handleSaveToken = async () => {
    if (!token.trim()) {
      setTokenError('Please enter a GitHub personal access token')
      return
    }

    setIsLoadingToken(true)
    setTokenError('')

    try {
      const response = await fetch(`/api/repos/${repo.id}/codespaces-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save token')
      }

      toast({
        title: 'Token Configured',
        description: 'GitHub Codespaces access has been enabled.',
      })

      setToken('')
      onTokenUpdated()
      // Check devcontainer and fetch codespaces after token save
      checkDevcontainerStatus()
      fetchCodespaces()
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : 'Failed to save token')
    } finally {
      setIsLoadingToken(false)
    }
  }

  const handleRemoveToken = async () => {
    setIsRemovingToken(true)
    setTokenError('')

    try {
      const response = await fetch(`/api/repos/${repo.id}/codespaces-token`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to remove token')
      }

      toast({
        title: 'Token Removed',
        description: 'GitHub Codespaces access has been disabled.',
      })

      setDevcontainerStatus(null)
      setCodespaces([])
      onTokenUpdated()
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : 'Failed to remove token')
    } finally {
      setIsRemovingToken(false)
    }
  }

  const handleSetupDevcontainer = async () => {
    setIsSettingUpDevcontainer(true)
    try {
      const response = await fetch(`/api/repos/${repo.id}/setup-devcontainer`, {
        method: 'POST',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to setup devcontainer')
      }

      toast({
        title: 'Devcontainer Configured',
        description: data.wasUpdated
          ? 'Updated devcontainer.json. Rebuild your Codespace to apply.'
          : 'Created devcontainer.json. Create a Codespace to use it.',
      })

      checkDevcontainerStatus()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to setup devcontainer',
      })
    } finally {
      setIsSettingUpDevcontainer(false)
    }
  }

  const handleStartCodespace = async (codespaceName: string) => {
    setStartingCodespace(codespaceName)
    try {
      const response = await fetch(`/api/projects/${projectId}/codespaces/${codespaceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to start codespace')
      }

      toast({
        title: 'Starting Codespace',
        description: 'This may take a minute. Refresh to see updated status.',
      })

      // Refresh after a delay
      setTimeout(fetchCodespaces, 3000)
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to start',
      })
    } finally {
      setStartingCodespace(null)
    }
  }

  const handleStopCodespace = async (codespaceName: string) => {
    setStoppingCodespace(codespaceName)
    try {
      const response = await fetch(`/api/projects/${projectId}/codespaces/${codespaceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to stop codespace')
      }

      toast({
        title: 'Stopping Codespace',
        description: 'The codespace is being stopped.',
      })

      setTimeout(fetchCodespaces, 2000)
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to stop',
      })
    } finally {
      setStoppingCodespace(null)
    }
  }

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Not configured - show setup flow
  if (!repo.has_codespaces_token) {
    return (
      <div className="p-4 bg-muted/30 rounded-lg space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
            <Wand2 className="h-4 w-4 text-amber-600" />
          </div>
          <div>
            <h4 className="font-medium text-sm">Enable Claude Code Workspace</h4>
            <p className="text-sm text-muted-foreground mt-1">
              Configure GitHub access to create Codespaces and use Claude Code directly in LaneShare.
            </p>
          </div>
        </div>

        {/* Token input */}
        <div className="space-y-2">
          <Label htmlFor={`token-${repo.id}`} className="text-sm flex items-center gap-2">
            <Key className="h-3.5 w-3.5" />
            GitHub Personal Access Token
          </Label>
          <div className="flex gap-2">
            <Input
              id={`token-${repo.id}`}
              type="password"
              value={token}
              onChange={(e) => {
                setToken(e.target.value)
                setTokenError('')
              }}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              className="font-mono text-sm"
            />
            <Button onClick={handleSaveToken} disabled={isLoadingToken || !token.trim()}>
              {isLoadingToken ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            <a
              href="https://github.com/settings/tokens/new?scopes=codespace,repo"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              Create token with codespace + repo scopes
              <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>

        {tokenError && (
          <Alert variant="destructive">
            <AlertDescription className="text-sm">{tokenError}</AlertDescription>
          </Alert>
        )}
      </div>
    )
  }

  // Configured - show status and codespaces
  return (
    <div className="p-4 bg-muted/30 rounded-lg space-y-4">
      {/* Token status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <span className="text-sm font-medium">GitHub Token Configured</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRemoveToken}
          disabled={isRemovingToken}
          className="text-muted-foreground hover:text-destructive"
        >
          {isRemovingToken ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </div>

      {/* Devcontainer setup */}
      <div className="p-3 bg-background rounded-lg border space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileCode className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Devcontainer Configuration</span>
          </div>
          {isCheckingDevcontainer ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : devcontainerStatus?.hasLaneshareConfig ? (
            <Badge variant="outline" className="border-green-500 text-green-600 text-xs">
              <CheckCircle className="h-3 w-3 mr-1" />
              Ready
            </Badge>
          ) : devcontainerStatus?.hasDevcontainer ? (
            <Badge variant="outline" className="border-yellow-500 text-yellow-600 text-xs">
              Needs Update
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs">Not Configured</Badge>
          )}
        </div>

        {devcontainerStatus?.hasLaneshareConfig ? (
          <p className="text-xs text-muted-foreground">
            Your repository is configured for Claude Code with ttyd terminal access.
          </p>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {devcontainerStatus?.hasDevcontainer
                ? 'Update devcontainer.json to enable Claude Code and ttyd.'
                : 'Add devcontainer.json to auto-setup Claude Code in Codespaces.'}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSetupDevcontainer}
              disabled={isSettingUpDevcontainer}
            >
              {isSettingUpDevcontainer ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Settings className="h-4 w-4 mr-2" />
                  {devcontainerStatus?.hasDevcontainer ? 'Update' : 'Setup'}
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Existing Codespaces */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Codespaces</span>
          <Button variant="ghost" size="sm" onClick={fetchCodespaces} disabled={isLoadingCodespaces}>
            {isLoadingCodespaces ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <span className="text-xs text-muted-foreground">Refresh</span>
            )}
          </Button>
        </div>

        {isLoadingCodespaces ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : codespaces.length === 0 ? (
          <div className="text-center py-4 text-sm text-muted-foreground">
            <Cloud className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No codespaces found for this repository.</p>
            <p className="text-xs mt-1">Create one from the Workspace page.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {codespaces.map((cs) => (
              <div
                key={cs.name}
                className="flex items-center justify-between p-2 bg-background rounded-lg border"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={`h-2 w-2 rounded-full flex-shrink-0 ${
                      cs.state === 'Available'
                        ? 'bg-green-500'
                        : cs.state === 'Shutdown'
                        ? 'bg-gray-400'
                        : 'bg-yellow-500 animate-pulse'
                    }`}
                  />
                  <span className="text-sm truncate">{cs.name}</span>
                  <Badge variant="secondary" className="text-xs">
                    {cs.state}
                  </Badge>
                </div>
                <div className="flex items-center gap-1">
                  {cs.state === 'Available' ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => handleStopCodespace(cs.name)}
                        disabled={stoppingCodespace === cs.name}
                      >
                        {stoppingCodespace === cs.name ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <StopCircle className="h-4 w-4 text-orange-500" />
                        )}
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        className="h-7 px-2 bg-amber-600 hover:bg-amber-700"
                        onClick={() => router.push(`/projects/${projectId}/workspace`)}
                      >
                        <Wand2 className="h-4 w-4 mr-1" />
                        Open
                      </Button>
                    </>
                  ) : cs.state === 'Shutdown' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => handleStartCodespace(cs.name)}
                      disabled={startingCodespace === cs.name}
                    >
                      {startingCodespace === cs.name ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Play className="h-4 w-4 mr-1" />
                          Start
                        </>
                      )}
                    </Button>
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick action */}
      <div className="pt-2 border-t">
        <Button
          variant="default"
          className="w-full bg-amber-600 hover:bg-amber-700"
          onClick={() => router.push(`/projects/${projectId}/workspace`)}
        >
          <Wand2 className="h-4 w-4 mr-2" />
          Open Workspace
          <ArrowRight className="h-4 w-4 ml-auto" />
        </Button>
      </div>
    </div>
  )
}
