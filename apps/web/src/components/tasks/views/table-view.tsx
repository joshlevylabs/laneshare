'use client'

import { useState, useMemo } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Bug,
  Zap,
  BookOpen,
  FlaskConical,
  CheckSquare,
  LayoutList,
  GitBranch,
  CornerDownRight,
} from 'lucide-react'
import type { Task, Sprint, TaskType, TaskStatus, TaskPriority } from '@laneshare/shared'

interface Member {
  id: string
  email: string
  full_name: string | null
  avatar_url?: string | null
}

interface TaskTableViewProps {
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

const STATUS_STYLES: Record<TaskStatus, string> = {
  BACKLOG: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100',
  TODO: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100',
  IN_REVIEW: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100',
  BLOCKED: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
  DONE: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
}

const PRIORITY_STYLES: Record<TaskPriority, string> = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-blue-100 text-blue-600',
  HIGH: 'bg-orange-100 text-orange-600',
  URGENT: 'bg-red-100 text-red-600',
}

type SortField = 'key' | 'title' | 'status' | 'priority' | 'assignee' | 'sprint' | 'updated_at' | 'due_date'
type SortDirection = 'asc' | 'desc'

export function TaskTableView({
  projectId,
  tasks,
  sprints,
  members,
  onTaskClick,
  onTaskUpdate,
}: TaskTableViewProps) {
  const [sortField, setSortField] = useState<SortField>('updated_at')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      let comparison = 0

      switch (sortField) {
        case 'key':
          comparison = a.key.localeCompare(b.key)
          break
        case 'title':
          comparison = a.title.localeCompare(b.title)
          break
        case 'status':
          comparison = a.status.localeCompare(b.status)
          break
        case 'priority':
          const priorityOrder = { LOW: 0, MEDIUM: 1, HIGH: 2, URGENT: 3 }
          comparison = priorityOrder[a.priority] - priorityOrder[b.priority]
          break
        case 'assignee':
          const aName = a.assignee?.full_name || a.assignee?.email || ''
          const bName = b.assignee?.full_name || b.assignee?.email || ''
          comparison = aName.localeCompare(bName)
          break
        case 'sprint':
          const aSprint = sprints.find((s) => s.id === a.sprint_id)?.name || ''
          const bSprint = sprints.find((s) => s.id === b.sprint_id)?.name || ''
          comparison = aSprint.localeCompare(bSprint)
          break
        case 'updated_at':
          comparison = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
          break
        case 'due_date':
          const aDate = a.due_date ? new Date(a.due_date).getTime() : Infinity
          const bDate = b.due_date ? new Date(b.due_date).getTime() : Infinity
          comparison = aDate - bDate
          break
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [tasks, sortField, sortDirection, sprints])

  const SortableHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8 data-[state=open]:bg-accent"
      onClick={() => handleSort(field)}
    >
      {children}
      {sortField === field ? (
        sortDirection === 'asc' ? (
          <ArrowUp className="ml-2 h-4 w-4" />
        ) : (
          <ArrowDown className="ml-2 h-4 w-4" />
        )
      ) : (
        <ArrowUpDown className="ml-2 h-4 w-4 opacity-50" />
      )}
    </Button>
  )

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[100px]">
              <SortableHeader field="key">Key</SortableHeader>
            </TableHead>
            <TableHead className="min-w-[200px]">
              <SortableHeader field="title">Title</SortableHeader>
            </TableHead>
            <TableHead className="w-[100px]">Type</TableHead>
            <TableHead className="w-[120px]">
              <SortableHeader field="status">Status</SortableHeader>
            </TableHead>
            <TableHead className="w-[100px]">
              <SortableHeader field="priority">Priority</SortableHeader>
            </TableHead>
            <TableHead className="w-[150px]">
              <SortableHeader field="assignee">Assignee</SortableHeader>
            </TableHead>
            <TableHead className="w-[120px]">
              <SortableHeader field="sprint">Sprint</SortableHeader>
            </TableHead>
            <TableHead className="w-[80px]">Points</TableHead>
            <TableHead className="w-[100px]">
              <SortableHeader field="due_date">Due</SortableHeader>
            </TableHead>
            <TableHead className="w-[120px]">
              <SortableHeader field="updated_at">Updated</SortableHeader>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedTasks.length === 0 ? (
            <TableRow>
              <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                No tasks found
              </TableCell>
            </TableRow>
          ) : (
            sortedTasks.map((task) => {
              const TypeIcon = TYPE_ICONS[task.type]
              const sprint = sprints.find((s) => s.id === task.sprint_id)

              return (
                <TableRow
                  key={task.id}
                  className="cursor-pointer"
                  onClick={() => onTaskClick(task.id)}
                >
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {task.key}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium line-clamp-1">{task.title}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <TypeIcon className={cn('h-4 w-4', TYPE_COLORS[task.type])} />
                      <span className="text-sm">{task.type}</span>
                      {task.parent_task_id && (
                        <CornerDownRight className="h-3 w-3 text-muted-foreground" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={cn('text-xs', STATUS_STYLES[task.status])}>
                      {task.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={cn('text-xs', PRIORITY_STYLES[task.priority])}>
                      {task.priority}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {task.assignee ? (
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={task.assignee.avatar_url || undefined} />
                          <AvatarFallback className="text-xs">
                            {(task.assignee.full_name || task.assignee.email)
                              .slice(0, 2)
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm truncate max-w-[100px]">
                          {task.assignee.full_name || task.assignee.email}
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {sprint ? (
                      <span className="text-sm">{sprint.name}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {task.story_points !== null && task.story_points !== undefined ? (
                      <Badge variant="outline" className="text-xs">
                        {task.story_points}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {task.due_date ? (
                      <span className="text-sm">
                        {format(new Date(task.due_date), 'MMM d')}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(task.updated_at), 'MMM d, h:mm a')}
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </div>
  )
}
