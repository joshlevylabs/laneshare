'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { GitBranch, Loader2, Sparkles } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import type { Sidequest } from '@laneshare/shared'

interface Repo {
  id: string
  owner: string
  name: string
  default_branch?: string
}

interface SidequestCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  repos: Repo[]
  onCreated: (sidequest: Sidequest) => void
}

export function SidequestCreateDialog({
  open,
  onOpenChange,
  projectId,
  repos,
  onCreated,
}: SidequestCreateDialogProps) {
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selectedRepos, setSelectedRepos] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const handleRepoToggle = (repoId: string) => {
    setSelectedRepos((prev) =>
      prev.includes(repoId) ? prev.filter((id) => id !== repoId) : [...prev, repoId]
    )
  }

  const handleSelectAll = () => {
    if (selectedRepos.length === repos.length) {
      setSelectedRepos([])
    } else {
      setSelectedRepos(repos.map((r) => r.id))
    }
  }

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast({ title: 'Validation Error', description: 'Please enter a title', variant: 'destructive' })
      return
    }

    if (selectedRepos.length === 0) {
      toast({ title: 'Validation Error', description: 'Please select at least one repository', variant: 'destructive' })
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch(`/api/projects/${projectId}/sidequests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          repo_ids: selectedRepos,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create sidequest')
      }

      const sidequest = await response.json()
      toast({ title: 'Success', description: 'Sidequest created! Starting planning session...' })
      onCreated(sidequest)
      onOpenChange(false)

      // Reset form
      setTitle('')
      setDescription('')
      setSelectedRepos([])
    } catch (error) {
      console.error('Create sidequest error:', error)
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to create sidequest', variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            New Sidequest
          </DialogTitle>
          <DialogDescription>
            Start a new planning session with AI assistance. Describe what you want to build and
            I&apos;ll help you break it down into actionable tasks.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="e.g., Add user authentication"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">
              Description <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="description"
              placeholder="Briefly describe what you want to build..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isLoading}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Repositories</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSelectAll}
                disabled={isLoading || repos.length === 0}
              >
                {selectedRepos.length === repos.length ? 'Deselect All' : 'Select All'}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Select the repositories this sidequest will involve
            </p>

            {repos.length > 0 ? (
              <div className="border rounded-lg divide-y max-h-[200px] overflow-y-auto">
                {repos.map((repo) => (
                  <label
                    key={repo.id}
                    className="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedRepos.includes(repo.id)}
                      onCheckedChange={() => handleRepoToggle(repo.id)}
                      disabled={isLoading}
                    />
                    <GitBranch className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 truncate">
                      {repo.owner}/{repo.name}
                    </span>
                    {repo.default_branch && (
                      <Badge variant="outline" className="text-xs">
                        {repo.default_branch}
                      </Badge>
                    )}
                  </label>
                ))}
              </div>
            ) : (
              <div className="border rounded-lg p-4 text-center text-muted-foreground">
                <GitBranch className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No repositories connected to this project</p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading || !title.trim() || selectedRepos.length === 0}>
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Start Planning
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
