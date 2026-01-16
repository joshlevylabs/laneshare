'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Loader2,
  CheckCircle,
  XCircle,
  Cloud,
  PlayCircle,
  StopCircle,
  Plus,
  Trash2,
  RefreshCw,
  ExternalLink,
  GitBranch,
  Cpu,
  HardDrive,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import type { GitHubCodespace, GitHubCodespaceMachine } from '@/lib/github'

interface CodespaceWithRepo {
  codespace: GitHubCodespace
  repoId: string
  repoFullName: string
}

interface RepoInfo {
  id: string
  fullName: string
  hasToken: boolean
}

interface WorkspaceConnectionSetupProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  onConnect: (codespace: GitHubCodespace, repoId: string) => void
  selectedCodespace?: GitHubCodespace | null
}

export function WorkspaceConnectionSetup({
  open,
  onOpenChange,
  projectId,
  onConnect,
  selectedCodespace,
}: WorkspaceConnectionSetupProps) {
  const [codespaces, setCodespaces] = useState<CodespaceWithRepo[]>([])
  const [repos, setRepos] = useState<RepoInfo[]>([])
  const [machines, setMachines] = useState<GitHubCodespaceMachine[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // Create codespace form
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [selectedRepoId, setSelectedRepoId] = useState<string>('')
  const [selectedMachine, setSelectedMachine] = useState<string>('')
  const [isCreating, setIsCreating] = useState(false)

  // Action states
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  // Fetch codespaces on mount
  useEffect(() => {
    if (open) {
      fetchCodespaces()
    }
  }, [open, projectId])

  // Fetch machines when repo is selected
  useEffect(() => {
    if (selectedRepoId) {
      fetchMachines(selectedRepoId)
    }
  }, [selectedRepoId])

  const fetchCodespaces = async () => {
    setIsLoading(true)
    setError('')

    try {
      const response = await fetch(`/api/projects/${projectId}/codespaces`)
      if (!response.ok) {
        throw new Error('Failed to fetch codespaces')
      }

      const data = await response.json()
      setCodespaces(data.codespaces || [])
      setRepos(data.repos || [])
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to fetch codespaces')
    } finally {
      setIsLoading(false)
    }
  }

  const fetchMachines = async (repoId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/codespaces/machines?repoId=${repoId}`)
      if (response.ok) {
        const data = await response.json()
        setMachines(data.machines || [])
        if (data.machines?.length > 0) {
          setSelectedMachine(data.machines[0].name)
        }
      }
    } catch {
      // Ignore - machines are optional
    }
  }

  const handleCreateCodespace = async () => {
    if (!selectedRepoId) return

    setIsCreating(true)
    setError('')

    try {
      const response = await fetch(`/api/projects/${projectId}/codespaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoId: selectedRepoId,
          machine: selectedMachine || undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create codespace')
      }

      const { codespace } = await response.json()

      // Add to list and select it
      const repo = repos.find((r) => r.id === selectedRepoId)
      setCodespaces((prev) => [
        ...prev,
        { codespace, repoId: selectedRepoId, repoFullName: repo?.fullName || '' },
      ])
      setShowCreateForm(false)

      // Auto-connect to the new codespace
      onConnect(codespace, selectedRepoId)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create codespace')
    } finally {
      setIsCreating(false)
    }
  }

  const handleStartCodespace = async (codespaceName: string) => {
    setActionInProgress(codespaceName)

    try {
      const response = await fetch(`/api/projects/${projectId}/codespaces/${codespaceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      })

      if (response.ok) {
        await fetchCodespaces()
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to start codespace')
    } finally {
      setActionInProgress(null)
    }
  }

  const handleStopCodespace = async (codespaceName: string) => {
    setActionInProgress(codespaceName)

    try {
      const response = await fetch(`/api/projects/${projectId}/codespaces/${codespaceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      })

      if (response.ok) {
        await fetchCodespaces()
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to stop codespace')
    } finally {
      setActionInProgress(null)
    }
  }

  const handleDeleteCodespace = async (codespaceName: string) => {
    if (!confirm('Are you sure you want to delete this codespace? This action cannot be undone.')) {
      return
    }

    setActionInProgress(codespaceName)

    try {
      const response = await fetch(`/api/projects/${projectId}/codespaces/${codespaceName}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setCodespaces((prev) => prev.filter((c) => c.codespace.name !== codespaceName))
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to delete codespace')
    } finally {
      setActionInProgress(null)
    }
  }

  const getStatusColor = (state: GitHubCodespace['state']) => {
    switch (state) {
      case 'Available':
        return 'bg-green-500'
      case 'Starting':
      case 'Provisioning':
      case 'Queued':
        return 'bg-yellow-500 animate-pulse'
      case 'Shutdown':
        return 'bg-gray-500'
      case 'Failed':
        return 'bg-red-500'
      default:
        return 'bg-gray-400'
    }
  }

  const getStatusBadge = (state: GitHubCodespace['state']) => {
    switch (state) {
      case 'Available':
        return <Badge className="bg-green-500">Running</Badge>
      case 'Starting':
      case 'Provisioning':
      case 'Queued':
        return <Badge className="bg-yellow-500">Starting</Badge>
      case 'Shutdown':
        return <Badge variant="secondary">Stopped</Badge>
      case 'Failed':
        return <Badge variant="destructive">Failed</Badge>
      default:
        return <Badge variant="outline">{state}</Badge>
    }
  }

  const formatBytes = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024)
    return `${gb.toFixed(0)}GB`
  }

  const reposWithTokens = repos.filter((r) => r.hasToken)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            GitHub Codespaces
          </DialogTitle>
          <DialogDescription>
            Connect to a GitHub Codespace to run Claude Code agents in the cloud.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4 py-4">
          {/* Existing Codespaces */}
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Your Codespaces</Label>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={fetchCodespaces} disabled={isLoading}>
                <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCreateForm(!showCreateForm)}
              >
                <Plus className="h-4 w-4 mr-1" />
                New Codespace
              </Button>
            </div>
          </div>

          {/* Create Form */}
          {showCreateForm && (
            <div className="rounded-md border p-4 space-y-3 bg-muted/30">
              <div className="space-y-2">
                <Label htmlFor="repo">Repository</Label>
                <Select value={selectedRepoId} onValueChange={setSelectedRepoId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a repository" />
                  </SelectTrigger>
                  <SelectContent>
                    {reposWithTokens.length === 0 ? (
                      <SelectItem value="_none" disabled>
                        No repositories with GitHub tokens
                      </SelectItem>
                    ) : (
                      reposWithTokens.map((repo) => (
                        <SelectItem key={repo.id} value={repo.id}>
                          {repo.fullName}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              {machines.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="machine">Machine Type</Label>
                  <Select value={selectedMachine} onValueChange={setSelectedMachine}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select machine type" />
                    </SelectTrigger>
                    <SelectContent>
                      {machines.map((machine) => (
                        <SelectItem key={machine.name} value={machine.name}>
                          <div className="flex items-center gap-2">
                            <span>{machine.display_name}</span>
                            <span className="text-xs text-muted-foreground">
                              ({machine.cpus} cores, {formatBytes(machine.memory_in_bytes)} RAM)
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowCreateForm(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreateCodespace}
                  disabled={!selectedRepoId || isCreating}
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create Codespace'
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Codespaces List */}
          <ScrollArea className="flex-1 -mx-6 px-6">
            {isLoading && codespaces.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : codespaces.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Cloud className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No codespaces found</p>
                <p className="text-sm">Create a new codespace to get started</p>
              </div>
            ) : (
              <div className="space-y-2">
                {codespaces.map(({ codespace, repoId, repoFullName }) => (
                  <div
                    key={codespace.name}
                    className={cn(
                      'rounded-lg border p-3 hover:bg-muted/50 transition-colors',
                      selectedCodespace?.name === codespace.name && 'ring-2 ring-primary'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className={cn('w-2 h-2 rounded-full', getStatusColor(codespace.state))} />
                          <span className="font-medium truncate">
                            {codespace.display_name || codespace.name}
                          </span>
                          {getStatusBadge(codespace.state)}
                        </div>

                        <div className="mt-1 text-sm text-muted-foreground space-y-1">
                          <div className="flex items-center gap-4">
                            <span className="flex items-center gap-1">
                              <GitBranch className="h-3 w-3" />
                              {repoFullName}
                            </span>
                            {codespace.git_status && (
                              <span className="flex items-center gap-1">
                                <code className="text-xs">{codespace.git_status.ref}</code>
                              </span>
                            )}
                          </div>

                          {codespace.machine && (
                            <div className="flex items-center gap-4">
                              <span className="flex items-center gap-1">
                                <Cpu className="h-3 w-3" />
                                {codespace.machine.cpus} cores
                              </span>
                              <span className="flex items-center gap-1">
                                <HardDrive className="h-3 w-3" />
                                {formatBytes(codespace.machine.memory_in_bytes)} RAM
                              </span>
                            </div>
                          )}

                          <p className="text-xs">
                            Last used{' '}
                            {formatDistanceToNow(new Date(codespace.last_used_at), {
                              addSuffix: true,
                            })}
                          </p>
                        </div>

                        {/* Git status indicators */}
                        {codespace.git_status && (
                          <div className="mt-2 flex items-center gap-2 text-xs">
                            {codespace.git_status.has_uncommitted_changes && (
                              <Badge variant="outline" className="text-yellow-600">
                                Uncommitted changes
                              </Badge>
                            )}
                            {codespace.git_status.has_unpushed_changes && (
                              <Badge variant="outline" className="text-blue-600">
                                Unpushed commits
                              </Badge>
                            )}
                            {codespace.git_status.ahead > 0 && (
                              <Badge variant="outline" className="text-green-600">
                                {codespace.git_status.ahead} ahead
                              </Badge>
                            )}
                            {codespace.git_status.behind > 0 && (
                              <Badge variant="outline" className="text-orange-600">
                                {codespace.git_status.behind} behind
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1">
                        {codespace.state === 'Available' ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => handleStopCodespace(codespace.name)}
                              disabled={actionInProgress === codespace.name}
                            >
                              {actionInProgress === codespace.name ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <StopCircle className="h-4 w-4 text-orange-500" />
                              )}
                            </Button>
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => onConnect(codespace, repoId)}
                            >
                              Connect
                            </Button>
                          </>
                        ) : codespace.state === 'Shutdown' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleStartCodespace(codespace.name)}
                            disabled={actionInProgress === codespace.name}
                          >
                            {actionInProgress === codespace.name ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <PlayCircle className="h-4 w-4 mr-2 text-green-500" />
                            )}
                            Start
                          </Button>
                        ) : (
                          <Badge variant="outline">
                            {codespace.state}
                          </Badge>
                        )}

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => window.open(codespace.web_url, '_blank')}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          onClick={() => handleDeleteCodespace(codespace.name)}
                          disabled={actionInProgress === codespace.name}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Info box */}
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <p className="font-medium text-sm">About GitHub Codespaces</p>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• Cloud development environments hosted by GitHub</li>
              <li>• Each codespace runs in its own container with full dev tools</li>
              <li>• Changes are synced to your repository when you push</li>
              <li>• Billing is based on compute and storage usage</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
