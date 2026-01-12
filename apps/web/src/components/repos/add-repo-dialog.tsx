'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { useToast } from '@/components/ui/use-toast'
import { Loader2, Plus, Search } from 'lucide-react'

interface GitHubRepo {
  id: number
  name: string
  full_name: string
  owner: { login: string }
  default_branch: string
  private: boolean
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
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRepo, setSelectedRepo] = useState<string>('')

  useEffect(() => {
    if (open && repos.length === 0) {
      fetchRepos()
    }
  }, [open])

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

  const handleAdd = async () => {
    if (!selectedRepo) return

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
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to add repository')
      }

      toast({
        title: 'Repository Added',
        description: `${repo.full_name} has been added to the project.`,
      })

      setOpen(false)
      setSelectedRepo('')
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={isLoading || !selectedRepo}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add Repository
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
