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
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { TaskCard } from './task-card'

type TaskStatus = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE'

interface Task {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  assignee_id: string | null
  repo_scope: string[] | null
  profiles?: {
    id: string
    email: string
    full_name: string | null
  }
}

interface Member {
  id: string
  email: string
  full_name: string | null
}

interface TaskBoardProps {
  projectId: string
  initialTasks: Task[]
  members: Member[]
}

const columns: { id: TaskStatus; title: string; color: string }[] = [
  { id: 'BACKLOG', title: 'Backlog', color: 'bg-slate-500' },
  { id: 'TODO', title: 'To Do', color: 'bg-blue-500' },
  { id: 'IN_PROGRESS', title: 'In Progress', color: 'bg-yellow-500' },
  { id: 'BLOCKED', title: 'Blocked', color: 'bg-red-500' },
  { id: 'DONE', title: 'Done', color: 'bg-green-500' },
]

export function TaskBoard({ projectId, initialTasks, members }: TaskBoardProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [activeTask, setActiveTask] = useState<Task | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const getTasksByStatus = (status: TaskStatus) =>
    tasks.filter((task) => task.status === status)

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

    // Check if dropped on a column
    const targetColumn = columns.find((col) => col.id === overId)
    if (targetColumn) {
      const task = tasks.find((t) => t.id === taskId)
      if (task && task.status !== targetColumn.id) {
        // Update task status
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: targetColumn.id } : t
          )
        )

        try {
          const response = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: targetColumn.id }),
          })

          if (!response.ok) throw new Error('Failed to update task')

          router.refresh()
        } catch (error) {
          // Revert on error
          setTasks(initialTasks)
          toast({
            variant: 'destructive',
            title: 'Error',
            description: 'Failed to update task status',
          })
        }
      }
      return
    }

    // Check if dropped on another task
    const overTask = tasks.find((t) => t.id === overId)
    if (overTask) {
      const task = tasks.find((t) => t.id === taskId)
      if (task && task.status !== overTask.status) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: overTask.status } : t
          )
        )

        try {
          const response = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: overTask.status }),
          })

          if (!response.ok) throw new Error('Failed to update task')

          router.refresh()
        } catch (error) {
          setTasks(initialTasks)
          toast({
            variant: 'destructive',
            title: 'Error',
            description: 'Failed to update task status',
          })
        }
      }
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {columns.map((column) => {
          const columnTasks = getTasksByStatus(column.id)

          return (
            <Card key={column.id} className="bg-muted/30">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${column.color}`} />
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
                        projectId={projectId}
                        members={members}
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
            projectId={projectId}
            members={members}
            isDragging
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
