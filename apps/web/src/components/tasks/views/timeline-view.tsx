'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  addDays,
  addWeeks,
  startOfWeek,
  endOfWeek,
  format,
  differenceInDays,
  isWithinInterval,
  isBefore,
  isAfter,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Bug, Zap, BookOpen, FlaskConical, CheckSquare, LayoutList, GitBranch, CornerDownRight } from 'lucide-react'
import type { Task, Sprint, TaskType } from '@laneshare/shared'

interface TaskTimelineViewProps {
  projectId: string
  tasks: Task[]
  sprints: Sprint[]
  onTaskClick: (taskId: string) => void
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

const STATUS_COLORS: Record<string, string> = {
  BACKLOG: 'bg-gray-400',
  TODO: 'bg-blue-400',
  IN_PROGRESS: 'bg-yellow-400',
  IN_REVIEW: 'bg-purple-400',
  BLOCKED: 'bg-red-400',
  DONE: 'bg-green-400',
}

const SPRINT_COLORS = [
  'bg-blue-200 border-blue-400',
  'bg-purple-200 border-purple-400',
  'bg-teal-200 border-teal-400',
  'bg-orange-200 border-orange-400',
  'bg-pink-200 border-pink-400',
]

export function TaskTimelineView({
  projectId,
  tasks,
  sprints,
  onTaskClick,
}: TaskTimelineViewProps) {
  const [startDate, setStartDate] = useState(() => startOfWeek(new Date()))
  const weeksToShow = 8

  const endDate = addWeeks(startDate, weeksToShow)

  // Generate weeks for the header
  const weeks = useMemo(() => {
    const result = []
    let current = startDate
    while (isBefore(current, endDate)) {
      result.push({
        start: current,
        end: endOfWeek(current),
        label: format(current, 'MMM d'),
      })
      current = addWeeks(current, 1)
    }
    return result
  }, [startDate, endDate])

  // Filter tasks with dates
  const datedTasks = tasks.filter(
    (task) => task.start_date || task.due_date
  )

  // Filter sprints with dates
  const datedSprints = sprints.filter(
    (sprint) => sprint.start_date && sprint.end_date
  )

  const navigateWeeks = (direction: 'prev' | 'next') => {
    setStartDate((prev) =>
      direction === 'prev' ? addWeeks(prev, -4) : addWeeks(prev, 4)
    )
  }

  const getBarPosition = (itemStart: Date, itemEnd: Date) => {
    const totalDays = differenceInDays(endDate, startDate)
    const startDiff = Math.max(0, differenceInDays(itemStart, startDate))
    const endDiff = Math.min(totalDays, differenceInDays(itemEnd, startDate))

    const left = (startDiff / totalDays) * 100
    const width = ((endDiff - startDiff) / totalDays) * 100

    return { left: `${left}%`, width: `${Math.max(width, 2)}%` }
  }

  return (
    <div className="space-y-4">
      {/* Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => navigateWeeks('prev')}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => navigateWeeks('next')}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setStartDate(startOfWeek(new Date()))}>
            Today
          </Button>
        </div>
        <div className="text-sm text-muted-foreground">
          {format(startDate, 'MMM d, yyyy')} - {format(endDate, 'MMM d, yyyy')}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Timeline header */}
          <div className="flex border-b">
            <div className="w-64 shrink-0 p-3 border-r font-medium text-sm">
              Items
            </div>
            <div className="flex-1 flex">
              {weeks.map((week, i) => (
                <div
                  key={i}
                  className="flex-1 p-2 text-center text-xs text-muted-foreground border-r last:border-r-0"
                >
                  {week.label}
                </div>
              ))}
            </div>
          </div>

          {/* Sprints */}
          {datedSprints.length > 0 && (
            <div className="border-b">
              <div className="flex items-center gap-2 px-3 py-2 bg-muted/50">
                <span className="text-xs font-medium text-muted-foreground uppercase">
                  Sprints
                </span>
              </div>
              {datedSprints.map((sprint, index) => {
                const sprintStart = new Date(sprint.start_date!)
                const sprintEnd = new Date(sprint.end_date!)
                const position = getBarPosition(sprintStart, sprintEnd)
                const colorClass = SPRINT_COLORS[index % SPRINT_COLORS.length]

                return (
                  <div key={sprint.id} className="flex border-b last:border-b-0">
                    <div className="w-64 shrink-0 p-3 border-r">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{sprint.name}</span>
                        {sprint.status === 'ACTIVE' && (
                          <Badge variant="secondary" className="text-xs">Active</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {format(sprintStart, 'MMM d')} - {format(sprintEnd, 'MMM d')}
                      </div>
                    </div>
                    <div className="flex-1 relative h-16">
                      <div
                        className={cn(
                          'absolute top-3 h-10 rounded border-2 flex items-center px-2',
                          colorClass
                        )}
                        style={position}
                      >
                        <span className="text-xs font-medium truncate">
                          {sprint.name}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Tasks */}
          <div>
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
              <span className="text-xs font-medium text-muted-foreground uppercase">
                Tasks ({datedTasks.length} with dates)
              </span>
            </div>

            {datedTasks.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                No tasks with dates. Add start/due dates to see them here.
              </div>
            ) : (
              datedTasks.map((task) => {
                const taskStart = task.start_date
                  ? new Date(task.start_date)
                  : task.due_date
                  ? addDays(new Date(task.due_date), -1)
                  : new Date()
                const taskEnd = task.due_date
                  ? new Date(task.due_date)
                  : task.start_date
                  ? addDays(new Date(task.start_date), 1)
                  : new Date()
                const position = getBarPosition(taskStart, taskEnd)
                const TypeIcon = TYPE_ICONS[task.type]

                return (
                  <div
                    key={task.id}
                    className="flex border-b last:border-b-0 hover:bg-muted/50 cursor-pointer"
                    onClick={() => onTaskClick(task.id)}
                  >
                    <div className="w-64 shrink-0 p-3 border-r">
                      <div className="flex items-center gap-2">
                        <TypeIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-mono text-xs text-muted-foreground">
                          {task.key}
                        </span>
                      </div>
                      <div className="text-sm font-medium truncate mt-1">
                        {task.title}
                      </div>
                    </div>
                    <div className="flex-1 relative h-14">
                      <div
                        className={cn(
                          'absolute top-3 h-8 rounded flex items-center px-2',
                          STATUS_COLORS[task.status]
                        )}
                        style={position}
                      >
                        <span className="text-xs font-medium text-white truncate">
                          {task.title}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="font-medium">Status:</span>
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={cn('h-3 w-3 rounded', color)} />
            <span>{status.replace('_', ' ')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
