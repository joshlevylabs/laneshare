'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Plus, Search, GitBranch } from 'lucide-react'

interface GitHubRepo {
  id: number
  name: string
  full_name: string
  owner: { login: string }
  default_branch: string
  private: boolean
}

interface GitHubBranch {
  name: string
  commit: { sha: string }
  protected: boolean
}

interface AddRepoDialogProps {
  projectId: string
}

export function AddRepoDialog({ projectId }: AddRepoDialogProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [isFetchingBranches, setIsFetchingBranches] = useState(false)
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [branches, setBranches] = useState<GitHubBranch[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRepo, setSelectedRepo] = useState<string>('')
  const [selectedBranch, setSelectedBranch] = useState<string>('')
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false)

  useEffect(() => {
    if (open && repos.length === 0) {
      fetchRepos()
    }
  }, [open])

  // Fetch branches when repo is selected
  useEffect(() => {
    if (selectedRepo) {
      fetchBranches(selectedRepo)
    } else {
      setBranches([])
      setSelectedBranch('')
    }
  }, [selectedRepo])

  const fetchRepos = async () => {
    setIsSearching(true)
    try {
      const response = await fetch('/api/github/repos')
      if (!response.ok) throw new Error('Failed to fetch repos')
      const data = await response.json()
      setRepos(data)
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to fetch repositories',
      })
    } finally {
      setIsSearching(false)
    }
  }

  const fetchBranches = async (repoFullName: string) => {
    setIsFetchingBranches(true)
    setBranches([])
    setSelectedBranch('')

    try {
      const [owner, name] = repoFullName.split('/')
      const response = await fetch(`/api/github/repos/${owner}/${name}/branches`)
      if (!response.ok) throw new Error('Failed to fetch branches')
      const data = await response.json()
      setBranches(data)

      // Auto-select default branch if available
      const repo = repos.find((r) => r.full_name === repoFullName)
      if (repo && data.some((b: GitHubBranch) => b.name === repo.default_branch)) {
        setSelectedBranch(repo.default_branch)
      } else if (data.length > 0) {
        setSelectedBranch(data[0].name)
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to fetch branches',
      })
    } finally {
      setIsFetchingBranches(false)
    }
  }

  const handleAdd = async () => {
    if (!selectedRepo || !selectedBranch) return

    const repo = repos.find((r) => r.full_name === selectedRepo)
    if (!repo) return

    setIsLoading(true)

    try {
      const response = await fetch(`/api/projects/${projectId}/repos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: repo.owner.login,
          name: repo.name,
          defaultBranch: repo.default_branch,
          selectedBranch: selectedBranch,
          autoSyncEnabled: autoSyncEnabled,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to add repository')
      }

      toast({
        title: 'Repository Added',
        description: `${repo.full_name} (${selectedBranch}) has been added to the project.`,
      })

      setOpen(false)
      setSelectedRepo('')
      setSelectedBranch('')
      setAutoSyncEnabled(false)
      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add repository',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const filteredRepos = repos.filter((repo) =>
    repo.full_name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Repository
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Repository</DialogTitle>
          <DialogDescription>
            Select a GitHub repository to add to this project. The repository will be indexed
            for code search and context generation.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Search Repositories</Label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search your repositories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Select Repository</Label>
            {isSearching ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Select value={selectedRepo} onValueChange={setSelectedRepo}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a repository" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {filteredRepos.map((repo) => (
                    <SelectItem key={repo.id} value={repo.full_name}>
                      <div className="flex items-center gap-2">
                        <span>{repo.full_name}</span>
                        {repo.private && (
                          <span className="text-xs text-muted-foreground">(private)</span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                  {filteredRepos.length === 0 && (
                    <div className="py-4 text-center text-sm text-muted-foreground">
                      No repositories found
                    </div>
                  )}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Branch Selector */}
          {selectedRepo && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <GitBranch className="h-4 w-4" />
                Select Branch
              </Label>
              {isFetchingBranches ? (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Loading branches...</span>
                </div>
              ) : (
                <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a branch" />
                  </SelectTrigger>
                  <SelectContent className="max-h-48">
                    {branches.map((branch) => (
                      <SelectItem key={branch.name} value={branch.name}>
                        <div className="flex items-center gap-2">
                          <span>{branch.name}</span>
                          {branch.protected && (
                            <span className="text-xs text-muted-foreground">(protected)</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                    {branches.length === 0 && (
                      <div className="py-4 text-center text-sm text-muted-foreground">
                        No branches found
                      </div>
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Auto-sync Toggle */}
          {selectedRepo && selectedBranch && (
            <div className="flex items-center space-x-3 rounded-lg border p-4">
              <Checkbox
                id="auto-sync"
                checked={autoSyncEnabled}
                onCheckedChange={(checked) => setAutoSyncEnabled(checked === true)}
              />
              <div className="space-y-1">
                <Label htmlFor="auto-sync" className="cursor-pointer font-medium">
                  Enable auto-sync
                </Label>
                <p className="text-sm text-muted-foreground">
                  Automatically sync when new commits are pushed to this branch
                </p>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={isLoading || !selectedRepo || !selectedBranch}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add Repository
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
