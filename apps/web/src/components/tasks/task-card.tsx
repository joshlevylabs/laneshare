'use client'

import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  GripVertical,
  MoreHorizontal,
  MessageSquare,
  Trash2,
  Edit,
  Bug,
  Zap,
  BookOpen,
  FlaskConical,
  CheckSquare,
  LayoutList,
  GitBranch,
  CornerDownRight,
} from 'lucide-react'
import Link from 'next/link'
import { EditTaskDialog } from './edit-task-dialog'
import type { TaskType, HierarchyLevel } from '@laneshare/shared'

interface Task {
  id: string
  key?: string
  title: string
  description: string | null
  type?: TaskType
  status: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'BLOCKED' | 'DONE'
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  assignee_id: string | null
  parent_task_id?: string | null
  hierarchy_level?: HierarchyLevel
  repo_scope: string[] | null
  profiles?: {
    id: string
    email: string
    full_name: string | null
  }
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

interface Member {
  id: string
  email: string
  full_name: string | null
}

interface TaskCardProps {
  task: Task
  projectId: string
  members: Member[]
  isDragging?: boolean
}

const priorityColors = {
  LOW: 'bg-slate-500',
  MEDIUM: 'bg-blue-500',
  HIGH: 'bg-orange-500',
  URGENT: 'bg-red-500',
}

export function TaskCard({ task, projectId, members, isDragging }: TaskCardProps) {
  const [showEdit, setShowEdit] = useState(false)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const assignee = task.profiles || members.find((m) => m.id === task.assignee_id)

  return (
    <>
      <Card
        ref={setNodeRef}
        style={style}
        className={cn(
          'cursor-grab active:cursor-grabbing',
          (isDragging || isSortableDragging) && 'opacity-50 shadow-lg'
        )}
      >
        <CardHeader className="p-3 pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 flex-1">
              <div
                {...attributes}
                {...listeners}
                className="mt-0.5 cursor-grab text-muted-foreground hover:text-foreground"
              >
                <GripVertical className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                {/* Type icon and key */}
                <div className="flex items-center gap-1 mb-0.5">
                  {task.type && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className={cn('shrink-0', TYPE_COLORS[task.type])}>
                            {(() => {
                              const TypeIcon = TYPE_ICONS[task.type]
                              return <TypeIcon className="h-3.5 w-3.5" />
                            })()}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          {task.type}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {task.key && (
                    <span className="text-xs font-mono text-muted-foreground">
                      {task.key}
                    </span>
                  )}
                  {task.parent_task_id && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <CornerDownRight className="h-3 w-3 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          Has parent task
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <CardTitle className="text-sm font-medium leading-tight">
                  {task.title}
                </CardTitle>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setShowEdit(true)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/projects/${projectId}/chat?taskId=${task.id}`}>
                    <MessageSquare className="mr-2 h-4 w-4" />
                    Generate Prompt
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          {task.description && (
            <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
              {task.description}
            </p>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <div
                className={cn(
                  'w-2 h-2 rounded-full',
                  priorityColors[task.priority]
                )}
                title={task.priority}
              />
              {task.repo_scope && task.repo_scope.length > 0 && (
                <Badge variant="outline" className="text-xs px-1 py-0">
                  {task.repo_scope.length} repo{task.repo_scope.length > 1 ? 's' : ''}
                </Badge>
              )}
            </div>
            {assignee && (
              <Avatar className="h-6 w-6">
                <AvatarFallback className="text-xs">
                  {(assignee.full_name || assignee.email)[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
            )}
          </div>
        </CardContent>
      </Card>

      <EditTaskDialog
        open={showEdit}
        onOpenChange={setShowEdit}
        task={task}
        projectId={projectId}
        members={members}
      />
    </>
  )
}
