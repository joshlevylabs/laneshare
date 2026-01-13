'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import {
  Plus,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Play,
  CheckCircle,
  Trash2,
  Bug,
  Zap,
  BookOpen,
  FlaskConical,
  CheckSquare,
  GripVertical,
  Loader2,
} from 'lucide-react'
import type { Task, Sprint, TaskType } from '@laneshare/shared'

interface Member {
  id: string
  email: string
  full_name: string | null
  avatar_url?: string | null
}

interface TaskBacklogViewProps {
  projectId: string
  tasks: Task[]
  sprints: Sprint[]
  members: Member[]
  onTaskClick: (taskId: string) => void
  onTaskUpdate: (task: Task) => void
}

const TYPE_ICONS: Record<TaskType, React.ElementType> = {
  EPIC: Zap,
  STORY: BookOpen,
  TASK: CheckSquare,
  BUG: Bug,
  SPIKE: FlaskConical,
}

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'bg-gray-400',
  MEDIUM: 'bg-blue-400',
  HIGH: 'bg-orange-400',
  URGENT: 'bg-red-500',
}

function BacklogTaskRow({
  task,
  onClick,
  onMoveToSprint,
  sprints,
}: {
  task: Task
  onClick: () => void
  onMoveToSprint: (sprintId: string | null) => void
  sprints: Sprint[]
}) {
  const TypeIcon = TYPE_ICONS[task.type]

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-2 border-b hover:bg-muted/50 cursor-pointer group"
    >
      <GripVertical className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" />

      <div className="flex items-center gap-2 min-w-[100px]">
        <TypeIcon className="h-4 w-4 text-muted-foreground" />
        <span className="font-mono text-xs text-muted-foreground">{task.key}</span>
      </div>

      <div className="flex-1 min-w-0">
        <span className="text-sm truncate">{task.title}</span>
      </div>

      <div
        className={cn('h-2 w-2 rounded-full shrink-0', PRIORITY_COLORS[task.priority])}
        title={task.priority}
      />

      {task.story_points !== undefined && task.story_points !== null && (
        <Badge variant="outline" className="text-xs shrink-0">
          {task.story_points} SP
        </Badge>
      )}

      {task.assignee && (
        <Avatar className="h-6 w-6 shrink-0">
          <AvatarImage src={task.assignee.avatar_url || undefined} />
          <AvatarFallback className="text-xs">
            {(task.assignee.full_name || task.assignee.email).slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onMoveToSprint(null)}>
            Move to Backlog
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {sprints.map((sprint) => (
            <DropdownMenuItem
              key={sprint.id}
              onClick={() => onMoveToSprint(sprint.id)}
            >
              Move to {sprint.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function SprintSection({
  sprint,
  tasks,
  projectId,
  sprints,
  onTaskClick,
  onTaskUpdate,
  onSprintUpdate,
}: {
  sprint: Sprint | null
  tasks: Task[]
  projectId: string
  sprints: Sprint[]
  onTaskClick: (taskId: string) => void
  onTaskUpdate: (task: Task) => void
  onSprintUpdate: (sprint: Sprint) => void
}) {
  const { toast } = useToast()
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(true)
  const [isLoading, setIsLoading] = useState(false)

  const isBacklog = sprint === null
  const title = isBacklog ? 'Backlog' : sprint.name
  const totalPoints = tasks.reduce((sum, t) => sum + (t.story_points || 0), 0)
  const completedPoints = tasks
    .filter((t) => t.status === 'DONE')
    .reduce((sum, t) => sum + (t.story_points || 0), 0)

  const handleMoveToSprint = async (taskId: string, sprintId: string | null) => {
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return

    try {
      const response = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sprint_id: sprintId }),
      })

      if (!response.ok) throw new Error('Failed to move task')

      const updatedTask = await response.json()
      onTaskUpdate(updatedTask)
      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to move task',
      })
    }
  }

  const handleSprintAction = async (action: 'start' | 'complete') => {
    if (!sprint) return
    setIsLoading(true)

    try {
      const response = await fetch(
        `/api/projects/${projectId}/sprints/${sprint.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: action === 'start' ? 'ACTIVE' : 'COMPLETED',
          }),
        }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update sprint')
      }

      const updatedSprint = await response.json()
      onSprintUpdate(updatedSprint)
      toast({
        title: action === 'start' ? 'Sprint started' : 'Sprint completed',
        description: `${sprint.name} has been ${action === 'start' ? 'started' : 'completed'}.`,
      })
      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update sprint',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className={cn(isBacklog ? 'bg-muted/30' : '')}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <CardTitle className="text-base">{title}</CardTitle>
                {sprint?.status === 'ACTIVE' && (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
                    Active
                  </Badge>
                )}
                {sprint?.status === 'COMPLETED' && (
                  <Badge variant="secondary">Completed</Badge>
                )}
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {tasks.length} issue{tasks.length !== 1 ? 's' : ''}
                </span>
                {totalPoints > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {completedPoints}/{totalPoints} SP
                  </span>
                )}

                {sprint && (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {sprint.status === 'PLANNED' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSprintAction('start')}
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Play className="h-3 w-3 mr-1" />
                            Start
                          </>
                        )}
                      </Button>
                    )}
                    {sprint.status === 'ACTIVE' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSprintAction('complete')}
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Complete
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
            {sprint?.goal && (
              <p className="text-sm text-muted-foreground mt-1">{sprint.goal}</p>
            )}
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="p-0">
            {tasks.length === 0 ? (
              <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
                {isBacklog ? 'No items in backlog' : 'No items in this sprint'}
              </div>
            ) : (
              <div className="divide-y">
                {tasks.map((task) => (
                  <BacklogTaskRow
                    key={task.id}
                    task={task}
                    onClick={() => onTaskClick(task.id)}
                    onMoveToSprint={(sprintId) => handleMoveToSprint(task.id, sprintId)}
                    sprints={sprints}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

export function TaskBacklogView({
  projectId,
  tasks,
  sprints: initialSprints,
  members,
  onTaskClick,
  onTaskUpdate,
}: TaskBacklogViewProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [sprints, setSprints] = useState(initialSprints)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newSprintName, setNewSprintName] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  // Group tasks by sprint
  const backlogTasks = tasks
    .filter((t) => t.sprint_id === null || t.status === 'BACKLOG')
    .sort((a, b) => a.rank - b.rank)

  const getSprintTasks = (sprintId: string) =>
    tasks
      .filter((t) => t.sprint_id === sprintId && t.status !== 'BACKLOG')
      .sort((a, b) => a.rank - b.rank)

  const handleCreateSprint = async () => {
    if (!newSprintName.trim()) return
    setIsCreating(true)

    try {
      const response = await fetch(`/api/projects/${projectId}/sprints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newSprintName.trim() }),
      })

      if (!response.ok) throw new Error('Failed to create sprint')

      const sprint = await response.json()
      setSprints((prev) => [sprint, ...prev])
      setNewSprintName('')
      setIsCreateOpen(false)
      toast({
        title: 'Sprint created',
        description: `${sprint.name} has been created.`,
      })
      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to create sprint',
      })
    } finally {
      setIsCreating(false)
    }
  }

  const handleSprintUpdate = (updatedSprint: Sprint) => {
    setSprints((prev) =>
      prev.map((s) => (s.id === updatedSprint.id ? updatedSprint : s))
    )
  }

  // Sort sprints: active first, then planned, then completed
  const sortedSprints = [...sprints].sort((a, b) => {
    const order = { ACTIVE: 0, PLANNED: 1, COMPLETED: 2 }
    return order[a.status] - order[b.status]
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Backlog</h2>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="h-4 w-4 mr-1" />
              Create Sprint
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Sprint</DialogTitle>
              <DialogDescription>
                Create a new sprint to organize your work.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Input
                placeholder="Sprint name"
                value={newSprintName}
                onChange={(e) => setNewSprintName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateSprint()}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateSprint} disabled={isCreating || !newSprintName.trim()}>
                {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Sprints */}
      {sortedSprints.map((sprint) => (
        <SprintSection
          key={sprint.id}
          sprint={sprint}
          tasks={getSprintTasks(sprint.id)}
          projectId={projectId}
          sprints={sprints}
          onTaskClick={onTaskClick}
          onTaskUpdate={onTaskUpdate}
          onSprintUpdate={handleSprintUpdate}
        />
      ))}

      {/* Backlog */}
      <SprintSection
        sprint={null}
        tasks={backlogTasks}
        projectId={projectId}
        sprints={sprints}
        onTaskClick={onTaskClick}
        onTaskUpdate={onTaskUpdate}
        onSprintUpdate={() => {}}
      />
    </div>
  )
}
