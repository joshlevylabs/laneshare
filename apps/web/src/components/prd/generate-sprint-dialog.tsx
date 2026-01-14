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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { Loader2, Rocket, Calendar } from 'lucide-react'
import type { Sprint } from '@laneshare/shared'

interface Member {
  id: string
  email: string
  full_name: string | null
}

interface GenerateSprintDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  prdId: string
  selectedStoryIds: string[]
  members: Member[]
  onSprintGenerated: (sprint: Sprint) => void
}

export function GenerateSprintDialog({
  open,
  onOpenChange,
  projectId,
  prdId,
  selectedStoryIds,
  members,
  onSprintGenerated,
}: GenerateSprintDialogProps) {
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [sprintName, setSprintName] = useState('')
  const [sprintGoal, setSprintGoal] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [defaultAssigneeId, setDefaultAssigneeId] = useState<string>('')

  const handleGenerate = async () => {
    if (!sprintName.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a sprint name',
        variant: 'destructive',
      })
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/prd/${prdId}/generate-sprint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          story_ids: selectedStoryIds,
          sprint_name: sprintName,
          sprint_goal: sprintGoal || undefined,
          start_date: startDate || null,
          end_date: endDate || null,
          default_assignee_id: defaultAssigneeId || null,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to generate sprint')
      }

      const result = await response.json()

      // Log full response for debugging
      console.log('Generate sprint result:', result)

      // Check for errors in task creation
      if (result.errors && result.errors.length > 0) {
        console.error('Task creation errors:', result.errors)
        toast({
          title: 'Partial Success',
          description: `Sprint created but ${result.errors.length} task(s) failed: ${result.errors[0]}`,
          variant: 'destructive',
        })
      } else if (result.created_tasks.length === 0) {
        toast({
          title: 'Warning',
          description: `Sprint "${result.sprint.name}" created but no tasks were generated. Stories may already exist as tasks.`,
          variant: 'destructive',
        })
      } else {
        toast({
          title: 'Sprint Generated',
          description: `Created sprint "${result.sprint.name}" with ${result.created_tasks.length} tasks`,
        })
      }

      // Show skipped stories info
      if (result.skipped_stories && result.skipped_stories.length > 0) {
        console.log('Skipped stories (already generated):', result.skipped_stories)
      }

      // Reset form
      setSprintName('')
      setSprintGoal('')
      setStartDate('')
      setEndDate('')
      setDefaultAssigneeId('')

      onSprintGenerated(result.sprint)
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to generate sprint',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  // Suggest sprint name based on story count
  const suggestSprintName = () => {
    const date = new Date()
    const weekNum = Math.ceil((date.getDate() + (new Date(date.getFullYear(), date.getMonth(), 1).getDay())) / 7)
    return `Sprint ${date.toLocaleString('default', { month: 'short' })} W${weekNum}`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" />
            Generate Sprint
          </DialogTitle>
          <DialogDescription>
            Create a new sprint with {selectedStoryIds.length} user {selectedStoryIds.length === 1 ? 'story' : 'stories'} as tasks.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="sprint-name">Sprint Name *</Label>
            <div className="flex gap-2">
              <Input
                id="sprint-name"
                placeholder="e.g., Sprint Jan W2"
                value={sprintName}
                onChange={(e) => setSprintName(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSprintName(suggestSprintName())}
              >
                Suggest
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sprint-goal">Sprint Goal (optional)</Label>
            <Textarea
              id="sprint-goal"
              placeholder="What's the objective of this sprint?"
              value={sprintGoal}
              onChange={(e) => setSprintGoal(e.target.value)}
              className="min-h-[80px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start-date">Start Date</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-date">End Date</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="default-assignee">Default Assignee (optional)</Label>
            <Select
              value={defaultAssigneeId || '__none__'}
              onValueChange={(value) => setDefaultAssigneeId(value === '__none__' ? '' : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select assignee for all tasks" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No default assignee</SelectItem>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.full_name || member.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleGenerate} disabled={isLoading || !sprintName.trim()}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Rocket className="h-4 w-4 mr-2" />
            )}
            Generate Sprint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
