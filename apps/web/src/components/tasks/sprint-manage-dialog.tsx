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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Calendar, Trash2, Play, CheckCircle, Pause } from 'lucide-react'
import type { Sprint } from '@laneshare/shared'

interface SprintManageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  sprint: Sprint
  onSprintUpdate: (sprint: Sprint) => void
  onSprintDelete: (sprintId: string) => void
}

type SprintStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETED'

const STATUS_OPTIONS: { value: SprintStatus; label: string; icon: React.ElementType; color: string }[] = [
  { value: 'PLANNED', label: 'Planned', icon: Pause, color: 'bg-gray-500' },
  { value: 'ACTIVE', label: 'Active', icon: Play, color: 'bg-green-500' },
  { value: 'COMPLETED', label: 'Completed', icon: CheckCircle, color: 'bg-blue-500' },
]

export function SprintManageDialog({
  open,
  onOpenChange,
  projectId,
  sprint,
  onSprintUpdate,
  onSprintDelete,
}: SprintManageDialogProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const [name, setName] = useState(sprint.name)
  const [goal, setGoal] = useState(sprint.goal || '')
  const [status, setStatus] = useState<SprintStatus>(sprint.status)
  const [startDate, setStartDate] = useState(sprint.start_date || '')
  const [endDate, setEndDate] = useState(sprint.end_date || '')

  const handleSave = async () => {
    if (!name.trim()) {
      toast({
        title: 'Error',
        description: 'Sprint name is required',
        variant: 'destructive',
      })
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/sprints/${sprint.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          goal: goal.trim() || null,
          status,
          start_date: startDate || null,
          end_date: endDate || null,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update sprint')
      }

      const updatedSprint = await response.json()
      onSprintUpdate(updatedSprint)
      toast({
        title: 'Sprint Updated',
        description: `"${updatedSprint.name}" has been updated`,
      })
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update sprint',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/sprints/${sprint.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete sprint')
      }

      onSprintDelete(sprint.id)
      toast({
        title: 'Sprint Deleted',
        description: `"${sprint.name}" has been deleted. Tasks moved to backlog.`,
      })
      setShowDeleteConfirm(false)
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete sprint',
        variant: 'destructive',
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const currentStatus = STATUS_OPTIONS.find(s => s.value === status)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Sprint</DialogTitle>
            <DialogDescription>
              Update sprint details or change its status.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="sprint-name">Sprint Name *</Label>
              <Input
                id="sprint-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Sprint Jan W2"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sprint-goal">Goal (optional)</Label>
              <Textarea
                id="sprint-goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="What's the objective of this sprint?"
                className="min-h-[80px]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sprint-status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as SprintStatus)}>
                <SelectTrigger>
                  <SelectValue>
                    {currentStatus && (
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${currentStatus.color}`} />
                        {currentStatus.label}
                      </div>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${option.color}`} />
                        {option.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {status === 'ACTIVE' && (
                <p className="text-xs text-muted-foreground">
                  Only one sprint can be active at a time.
                </p>
              )}
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
          </div>

          <DialogFooter className="flex justify-between sm:justify-between">
            <Button
              variant="destructive"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isLoading}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Sprint
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isLoading || !name.trim()}>
                {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Save Changes
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Sprint?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete "{sprint.name}" and move all its tasks back to the backlog.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Delete Sprint
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
