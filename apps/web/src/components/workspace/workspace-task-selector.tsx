'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Search, Loader2, Bug, Sparkles, Wrench, FileText, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TaskOption {
  id: string
  key: string
  title: string
  type: string
  status: string
  priority: string
}

interface WorkspaceTaskSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  existingTaskIds: string[]
  onSelectTask: (task: TaskOption) => void
}

const TYPE_ICONS = {
  BUG: Bug,
  FEATURE: Sparkles,
  TASK: Wrench,
  STORY: FileText,
  IMPROVEMENT: AlertTriangle,
}

const TYPE_COLORS = {
  BUG: 'text-red-500',
  FEATURE: 'text-purple-500',
  TASK: 'text-blue-500',
  STORY: 'text-green-500',
  IMPROVEMENT: 'text-orange-500',
}

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  TODO: 'outline',
  IN_PROGRESS: 'default',
  IN_REVIEW: 'secondary',
  DONE: 'secondary',
  BACKLOG: 'outline',
}

export function WorkspaceTaskSelector({
  open,
  onOpenChange,
  projectId,
  existingTaskIds,
  onSelectTask,
}: WorkspaceTaskSelectorProps) {
  const [search, setSearch] = useState('')
  const [tasks, setTasks] = useState<TaskOption[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (open) {
      fetchTasks()
    }
  }, [open, projectId])

  const fetchTasks = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/tasks`)
      if (response.ok) {
        const data = await response.json()
        setTasks(data)
      }
    } catch (error) {
      console.error('Error fetching tasks:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const filteredTasks = tasks.filter((task) => {
    // Filter out tasks that already have sessions
    if (existingTaskIds.includes(task.id)) return false

    // Filter by search term
    if (!search) return true
    const searchLower = search.toLowerCase()
    return (
      task.key.toLowerCase().includes(searchLower) ||
      task.title.toLowerCase().includes(searchLower)
    )
  })

  const handleSelect = (task: TaskOption) => {
    onSelectTask(task)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Select a Task</DialogTitle>
          <DialogDescription>
            Choose a task to start a new Claude Code session.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks by key or title..."
              className="pl-10"
            />
          </div>

          <ScrollArea className="h-[400px] border rounded-md">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <p>No tasks found</p>
                {existingTaskIds.length > 0 && (
                  <p className="text-sm mt-1">
                    ({existingTaskIds.length} task(s) already have active sessions)
                  </p>
                )}
              </div>
            ) : (
              <div className="divide-y">
                {filteredTasks.map((task) => {
                  const TypeIcon = TYPE_ICONS[task.type as keyof typeof TYPE_ICONS] || Wrench
                  const typeColor = TYPE_COLORS[task.type as keyof typeof TYPE_COLORS] || 'text-gray-500'

                  return (
                    <button
                      key={task.id}
                      className="w-full p-3 text-left hover:bg-muted transition-colors flex items-start gap-3"
                      onClick={() => handleSelect(task)}
                    >
                      <TypeIcon className={cn('h-5 w-5 mt-0.5 flex-shrink-0', typeColor)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {task.key}
                          </span>
                          <Badge variant={STATUS_VARIANTS[task.status] || 'outline'}>
                            {task.status.replace('_', ' ')}
                          </Badge>
                        </div>
                        <p className="font-medium truncate mt-1">{task.title}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}
