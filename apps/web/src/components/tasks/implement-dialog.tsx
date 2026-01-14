'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useToast } from '@/hooks/use-toast'
import {
  Bot,
  GitBranch,
  Check,
  Loader2,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react'
import type { Task, StartImplementationResponse } from '@laneshare/shared'
import { generateBranchName } from '@laneshare/shared'

interface Repo {
  id: string
  owner: string
  name: string
  default_branch: string
}

interface ImplementDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: Task
  projectId: string
  repos: Repo[]
  acceptanceCriteria: string[]
}

export function ImplementDialog({
  open,
  onOpenChange,
  task,
  projectId,
  repos,
  acceptanceCriteria,
}: ImplementDialogProps) {
  const { toast } = useToast()
  const router = useRouter()

  const [selectedRepoId, setSelectedRepoId] = useState<string>(repos[0]?.id || '')
  const [maxIterations, setMaxIterations] = useState<number>(10)
  const [isStarting, setIsStarting] = useState(false)

  const selectedRepo = repos.find((r) => r.id === selectedRepoId)
  const branchName = generateBranchName(task)

  const handleStart = async () => {
    if (!selectedRepoId) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Please select a repository',
      })
      return
    }

    setIsStarting(true)

    try {
      const response = await fetch(
        `/api/projects/${projectId}/tasks/${task.id}/implement`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repoId: selectedRepoId,
            maxIterations,
          }),
        }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to start implementation')
      }

      const data: StartImplementationResponse = await response.json()

      toast({
        title: 'Implementation started',
        description: `Branch: ${data.implementationBranch}`,
      })

      onOpenChange(false)

      // Navigate to the implementation status page
      router.push(`/projects/${projectId}/tasks/${task.id}/implement`)
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to start implementation',
      })
    } finally {
      setIsStarting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            AI Implementation
          </DialogTitle>
          <DialogDescription>
            Start autonomous implementation for{' '}
            <span className="font-mono text-foreground">{task.key}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Repository Selection */}
          <div className="space-y-2">
            <Label>Target Repository</Label>
            <Select value={selectedRepoId} onValueChange={setSelectedRepoId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a repository" />
              </SelectTrigger>
              <SelectContent>
                {repos.map((repo) => (
                  <SelectItem key={repo.id} value={repo.id}>
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-4 w-4" />
                      {repo.owner}/{repo.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedRepo && (
              <p className="text-xs text-muted-foreground">
                Will branch from: <span className="font-mono">{selectedRepo.default_branch}</span>
              </p>
            )}
          </div>

          {/* Branch Preview */}
          <div className="space-y-2">
            <Label>Implementation Branch</Label>
            <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              <code className="text-sm">{branchName}</code>
            </div>
          </div>

          {/* Max Iterations */}
          <div className="space-y-2">
            <Label>Maximum Iterations</Label>
            <Select
              value={maxIterations.toString()}
              onValueChange={(v) => setMaxIterations(parseInt(v, 10))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5 iterations</SelectItem>
                <SelectItem value="10">10 iterations (recommended)</SelectItem>
                <SelectItem value="15">15 iterations</SelectItem>
                <SelectItem value="20">20 iterations</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The agent will iterate until all criteria pass or this limit is reached.
            </p>
          </div>

          {/* Acceptance Criteria Preview */}
          <div className="space-y-2">
            <Label className="flex items-center justify-between">
              <span>Acceptance Criteria</span>
              <Badge variant="secondary">{acceptanceCriteria.length} items</Badge>
            </Label>
            <ScrollArea className="h-[120px] rounded-md border p-3">
              <ul className="space-y-2">
                {acceptanceCriteria.map((criterion, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <span>{criterion}</span>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-md text-sm">
            <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
            <div className="text-yellow-800 dark:text-yellow-200">
              <p className="font-medium">Review before merging</p>
              <p className="text-xs mt-1 opacity-80">
                AI-generated code will be committed to a feature branch and a draft PR
                will be created. Always review changes before merging.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isStarting}
          >
            Cancel
          </Button>
          <Button onClick={handleStart} disabled={isStarting || !selectedRepoId}>
            {isStarting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Bot className="h-4 w-4 mr-2" />
                Start Implementation
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
