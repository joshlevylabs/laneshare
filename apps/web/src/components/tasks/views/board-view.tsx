'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Bug, Zap, BookOpen, FlaskConical, CheckSquare, LayoutList, GitBranch, CornerDownRight, Settings } from 'lucide-react'
import { SELECT_SENTINELS, sprintSelect } from '@laneshare/shared'
import { SprintManageDialog } from '../sprint-manage-dialog'
import type { Task, Sprint, TaskStatus, TaskType } from '@laneshare/shared'

interface Member {
  id: string
  email: string
  full_name: string | null
  avatar_url?: string | null
}

interface TaskBoardViewProps {
  projectId: string
  tasks: Task[]
  sprints: Sprint[]
  members: Member[]
  onTaskClick: (taskId: string) => void
  onTaskUpdate: (task: Task) => void
  onSprintUpdate?: (sprint: Sprint) => void
  onSprintDelete?: (sprintId: string) => void
}

const COLUMNS: { id: TaskStatus; title: string; color: string }[] = [
  { id: 'TODO', title: 'To Do', color: 'bg-blue-500' },
  { id: 'IN_PROGRESS', title: 'In Progress', color: 'bg-yellow-500' },
  { id: 'IN_REVIEW', title: 'In Review', color: 'bg-purple-500' },
  { id: 'BLOCKED', title: 'Blocked', color: 'bg-red-500' },
  { id: 'DONE', title: 'Done', color: 'bg-green-500' },
]

const TYPE_ICONS: Record<TaskType, React.ElementType> = {
  EPIC: Zap,
  STORY: BookOpen,
  FEATURE: LayoutList,
  TASK: CheckSquare,
  BUG: Bug,
  SPIKE: FlaskConical,
  SUBTASK: GitBranch,
}

const TYPE_COLORS: Record<TaskType, string> = {
  EPIC: 'text-purple-500',
  STORY: 'text-blue-500',
  FEATURE: 'text-cyan-500',
  TASK: 'text-green-500',
  BUG: 'text-red-500',
  SPIKE: 'text-yellow-500',
  SUBTASK: 'text-gray-500',
}

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'bg-gray-400',
  MEDIUM: 'bg-blue-400',
  HIGH: 'bg-orange-400',
  URGENT: 'bg-red-500',
}

function TaskCard({
  task,
  onClick,
  isDragging,
}: {
  task: Task
  onClick: () => void
  isDragging?: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSorting,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const TypeIcon = TYPE_ICONS[task.type]

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        'bg-card border rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow',
        isDragging || isSorting ? 'opacity-50 shadow-lg' : ''
      )}
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TypeIcon className={cn('h-3.5 w-3.5', TYPE_COLORS[task.type])} />
            <span className="font-mono">{task.key}</span>
            {task.parent_task_id && (
              <CornerDownRight className="h-3 w-3 text-muted-foreground" />
            )}
          </div>
          <div
            className={cn('h-2 w-2 rounded-full', PRIORITY_COLORS[task.priority])}
            title={task.priority}
          />
        </div>

        <h4 className="text-sm font-medium line-clamp-2">{task.title}</h4>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {task.story_points !== undefined && task.story_points !== null && (
              <Badge variant="outline" className="text-xs px-1.5">
                {task.story_points} SP
              </Badge>
            )}
            {task.labels?.slice(0, 2).map((label) => (
              <Badge key={label} variant="secondary" className="text-xs px-1.5">
                {label}
              </Badge>
            ))}
          </div>

          {task.assignee && (
            <Avatar className="h-6 w-6">
              <AvatarImage src={task.assignee.avatar_url || undefined} />
              <AvatarFallback className="text-xs">
                {(task.assignee.full_name || task.assignee.email)
                  .slice(0, 2)
                  .toUpperCase()}
              </AvatarFallback>
            </Avatar>
          )}
        </div>
      </div>
    </div>
  )
}

export function TaskBoardView({
  projectId,
  tasks,
  sprints,
  members,
  onTaskClick,
  onTaskUpdate,
  onSprintUpdate,
  onSprintDelete,
}: TaskBoardViewProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [selectedSprintId, setSelectedSprintId] = useState<string>(
    SELECT_SENTINELS.ALL
  )
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [editingSprint, setEditingSprint] = useState<Sprint | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Filter tasks by selected sprint
  const sprintTasks = tasks.filter((task) => {
    if (selectedSprintId === SELECT_SENTINELS.ALL) {
      return task.status !== 'BACKLOG'
    }
    if (selectedSprintId === SELECT_SENTINELS.NO_SPRINT) {
      return task.sprint_id === null && task.status !== 'BACKLOG'
    }
    return task.sprint_id === selectedSprintId
  })

  const getTasksByStatus = (status: TaskStatus) =>
    sprintTasks
      .filter((task) => task.status === status)
      .sort((a, b) => a.rank - b.rank)

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id)
    if (task) setActiveTask(task)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveTask(null)

    if (!over) return

    const taskId = active.id as string
    const overId = over.id as string
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return

    // Check if dropped on a column
    const targetColumn = COLUMNS.find((col) => col.id === overId)
    const newStatus = targetColumn?.id

    // Or dropped on another task
    const overTask = tasks.find((t) => t.id === overId)
    const targetStatus = newStatus || overTask?.status

    if (!targetStatus || task.status === targetStatus) return

    // Optimistic update
    const updatedTask = { ...task, status: targetStatus }
    onTaskUpdate(updatedTask)

    try {
      const response = await fetch(
        `/api/projects/${projectId}/tasks/${taskId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: targetStatus }),
        }
      )

      if (!response.ok) throw new Error('Failed to update task')

      const data = await response.json()
      onTaskUpdate(data)
      router.refresh()
    } catch (error) {
      // Revert on error
      onTaskUpdate(task)
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update task status',
      })
    }
  }

  const activeSprint = sprints.find((s) => s.status === 'ACTIVE')

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select value={selectedSprintId} onValueChange={setSelectedSprintId}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Select sprint" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SELECT_SENTINELS.ALL}>All Sprints</SelectItem>
            <SelectItem value={SELECT_SENTINELS.NO_SPRINT}>No Sprint</SelectItem>
            {sprints.map((sprint) => (
              <SelectItem key={sprint.id} value={sprint.id}>
                {sprint.name}
                {sprint.status === 'ACTIVE' && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    Active
                  </Badge>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {activeSprint && selectedSprintId === SELECT_SENTINELS.ALL && (
          <Badge variant="outline">
            Active: {activeSprint.name}
          </Badge>
        )}

        {/* Edit Sprint button - show when a specific sprint is selected */}
        {selectedSprintId !== SELECT_SENTINELS.ALL &&
          selectedSprintId !== SELECT_SENTINELS.NO_SPRINT && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const sprint = sprints.find((s) => s.id === selectedSprintId)
                if (sprint) setEditingSprint(sprint)
              }}
            >
              <Settings className="h-4 w-4 mr-1" />
              Edit Sprint
            </Button>
          )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {COLUMNS.map((column) => {
            const columnTasks = getTasksByStatus(column.id)

            return (
              <Card key={column.id} className="bg-muted/30">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={cn('w-2 h-2 rounded-full', column.color)} />
                      <CardTitle className="text-sm font-medium">
                        {column.title}
                      </CardTitle>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {columnTasks.length}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="min-h-[200px]">
                  <SortableContext
                    id={column.id}
                    items={columnTasks.map((t) => t.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {columnTasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onClick={() => onTaskClick(task.id)}
                        />
                      ))}
                      {columnTasks.length === 0 && (
                        <div
                          className="h-20 border-2 border-dashed rounded-md flex items-center justify-center text-sm text-muted-foreground"
                          data-droppable={column.id}
                        >
                          Drop here
                        </div>
                      )}
                    </div>
                  </SortableContext>
                </CardContent>
              </Card>
            )
          })}
        </div>

        <DragOverlay>
          {activeTask ? (
            <TaskCard
              task={activeTask}
              onClick={() => {}}
              isDragging
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Sprint Management Dialog */}
      {editingSprint && (
        <SprintManageDialog
          open={!!editingSprint}
          onOpenChange={(open) => !open && setEditingSprint(null)}
          projectId={projectId}
          sprint={editingSprint}
          onSprintUpdate={(updated) => {
            onSprintUpdate?.(updated)
            setEditingSprint(null)
          }}
          onSprintDelete={(id) => {
            onSprintDelete?.(id)
            setSelectedSprintId(SELECT_SENTINELS.ALL)
            setEditingSprint(null)
          }}
        />
      )}
    </div>
  )
}
