'use client'

import { useState, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { TaskFiltersBar, TaskFilters, defaultFilters } from './task-filters'
import { TaskBoardView } from './views/board-view'
import { TaskBacklogView } from './views/backlog-view'
import { TaskTableView } from './views/table-view'
import { TaskTimelineView } from './views/timeline-view'
import { CreateTaskDialog } from './create-task-dialog'
import { TaskDetailDrawer } from './task-detail-drawer'
import { LayoutGrid, List, Calendar, Table2, Plus } from 'lucide-react'
import type { Task, Sprint, TaskStatus, TaskType, TaskPriority } from '@laneshare/shared'

interface Member {
  id: string
  email: string
  full_name: string | null
  avatar_url?: string | null
}

interface Repo {
  id: string
  owner: string
  name: string
}

interface TasksLayoutProps {
  projectId: string
  initialTasks: Task[]
  sprints: Sprint[]
  members: Member[]
  repos: Repo[]
}

type ViewType = 'board' | 'backlog' | 'table' | 'timeline'

export function TasksLayout({
  projectId,
  initialTasks,
  sprints,
  members,
  repos,
}: TasksLayoutProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const initialView = (searchParams.get('view') as ViewType) || 'board'
  const [currentView, setCurrentView] = useState<ViewType>(initialView)
  const [filters, setFilters] = useState<TaskFilters>(defaultFilters)
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  // Filter tasks based on current filters
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // Search filter
      if (filters.search) {
        const searchLower = filters.search.toLowerCase()
        const matchesSearch =
          task.title.toLowerCase().includes(searchLower) ||
          task.key.toLowerCase().includes(searchLower) ||
          task.description?.toLowerCase().includes(searchLower)
        if (!matchesSearch) return false
      }

      // Status filter
      if (filters.status && task.status !== filters.status) {
        return false
      }

      // Type filter
      if (filters.type && task.type !== filters.type) {
        return false
      }

      // Priority filter
      if (filters.priority && task.priority !== filters.priority) {
        return false
      }

      // Assignee filter
      if (filters.assigneeId !== null) {
        if (filters.assigneeId === '' && task.assignee_id !== null) {
          return false
        }
        if (filters.assigneeId && task.assignee_id !== filters.assigneeId) {
          return false
        }
      }

      // Sprint filter
      if (filters.sprintId !== null) {
        if (filters.sprintId === '' && task.sprint_id !== null) {
          return false
        }
        if (filters.sprintId && task.sprint_id !== filters.sprintId) {
          return false
        }
      }

      return true
    })
  }, [tasks, filters])

  const handleViewChange = (view: string) => {
    setCurrentView(view as ViewType)
    router.push(`/projects/${projectId}/tasks?view=${view}`, { scroll: false })
  }

  const handleTaskClick = (taskId: string) => {
    setSelectedTaskId(taskId)
    setIsDrawerOpen(true)
  }

  const handleTaskUpdate = (updatedTask: Task) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === updatedTask.id ? updatedTask : t))
    )
  }

  const handleTaskCreate = (newTask: Task) => {
    setTasks((prev) => [...prev, newTask])
  }

  const handleTaskDelete = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    if (selectedTaskId === taskId) {
      setIsDrawerOpen(false)
      setSelectedTaskId(null)
    }
  }

  const selectedTask = tasks.find((t) => t.id === selectedTaskId)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tasks</h1>
          <p className="text-muted-foreground">
            {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}
            {filters.search || Object.values(filters).some(Boolean)
              ? ' (filtered)'
              : ''}
          </p>
        </div>
        <CreateTaskDialog
          projectId={projectId}
          members={members}
          repos={repos}
          sprints={sprints}
          onTaskCreated={handleTaskCreate}
        />
      </div>

      <TaskFiltersBar
        filters={filters}
        onFiltersChange={setFilters}
        members={members}
        sprints={sprints}
        showSprintFilter={currentView !== 'backlog'}
      />

      <Tabs value={currentView} onValueChange={handleViewChange}>
        <TabsList>
          <TabsTrigger value="board" className="gap-2">
            <LayoutGrid className="h-4 w-4" />
            Board
          </TabsTrigger>
          <TabsTrigger value="backlog" className="gap-2">
            <List className="h-4 w-4" />
            Backlog
          </TabsTrigger>
          <TabsTrigger value="table" className="gap-2">
            <Table2 className="h-4 w-4" />
            Table
          </TabsTrigger>
          <TabsTrigger value="timeline" className="gap-2">
            <Calendar className="h-4 w-4" />
            Timeline
          </TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="mt-4">
          <TaskBoardView
            projectId={projectId}
            tasks={filteredTasks}
            sprints={sprints}
            members={members}
            onTaskClick={handleTaskClick}
            onTaskUpdate={handleTaskUpdate}
          />
        </TabsContent>

        <TabsContent value="backlog" className="mt-4">
          <TaskBacklogView
            projectId={projectId}
            tasks={filteredTasks}
            sprints={sprints}
            members={members}
            onTaskClick={handleTaskClick}
            onTaskUpdate={handleTaskUpdate}
          />
        </TabsContent>

        <TabsContent value="table" className="mt-4">
          <TaskTableView
            projectId={projectId}
            tasks={filteredTasks}
            sprints={sprints}
            members={members}
            onTaskClick={handleTaskClick}
            onTaskUpdate={handleTaskUpdate}
          />
        </TabsContent>

        <TabsContent value="timeline" className="mt-4">
          <TaskTimelineView
            projectId={projectId}
            tasks={filteredTasks}
            sprints={sprints}
            onTaskClick={handleTaskClick}
          />
        </TabsContent>
      </Tabs>

      <TaskDetailDrawer
        open={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        task={selectedTask || null}
        projectId={projectId}
        members={members}
        sprints={sprints}
        repos={repos}
        onTaskUpdate={handleTaskUpdate}
        onTaskDelete={handleTaskDelete}
      />
    </div>
  )
}
