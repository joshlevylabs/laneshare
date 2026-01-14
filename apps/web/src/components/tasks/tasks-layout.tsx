'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { TaskFiltersBar, TaskFilters, defaultFilters } from './task-filters'
import { TaskBoardView } from './views/board-view'
import { TaskBacklogView } from './views/backlog-view'
import { TaskTableView } from './views/table-view'
import { TaskTimelineView } from './views/timeline-view'
import { CreateTaskDialog } from './create-task-dialog'
import { TaskDetailModal } from './task-detail-modal'
import { PRDInputSection } from '@/components/prd'
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

interface AvailableContext {
  services: Array<{ id: string; service: string; display_name: string }>
  assets: Array<{ id: string; name: string; asset_type: string; service: string }>
  docs: Array<{ id: string; slug: string; title: string; category?: string }>
  features: Array<{ id: string; feature_slug: string; feature_name: string; description?: string }>
  tickets: Array<{ id: string; key: string; title: string; status: string; type: TaskType }>
}

interface TasksLayoutProps {
  projectId: string
  initialTasks: Task[]
  sprints: Sprint[]
  members: Member[]
  repos: Repo[]
  availableContext?: AvailableContext
}

type ViewType = 'board' | 'backlog' | 'table' | 'timeline'

export function TasksLayout({
  projectId,
  initialTasks,
  sprints: initialSprints,
  members,
  repos,
  availableContext,
}: TasksLayoutProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const initialView = (searchParams.get('view') as ViewType) || 'board'
  const [currentView, setCurrentView] = useState<ViewType>(initialView)
  const [filters, setFilters] = useState<TaskFilters>(defaultFilters)
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [sprints, setSprints] = useState<Sprint[]>(initialSprints)
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

  const handleSprintCreated = useCallback((newSprint: Sprint) => {
    setSprints((prev) => [newSprint, ...prev])
  }, [])

  const handleSprintUpdate = useCallback((updatedSprint: Sprint) => {
    setSprints((prev) =>
      prev.map((s) => (s.id === updatedSprint.id ? updatedSprint : s))
    )
  }, [])

  const handleSprintDelete = useCallback((sprintId: string) => {
    setSprints((prev) => prev.filter((s) => s.id !== sprintId))
    // Also update tasks that were in this sprint to have no sprint
    setTasks((prev) =>
      prev.map((t) => (t.sprint_id === sprintId ? { ...t, sprint_id: undefined } : t))
    )
  }, [])

  const handleTasksCreatedFromPRD = useCallback(async () => {
    // Refresh tasks from the server
    try {
      const response = await fetch(`/api/projects/${projectId}/tasks`)
      if (response.ok) {
        const newTasks = await response.json()
        setTasks(newTasks)
      }
    } catch (error) {
      console.error('Error refreshing tasks:', error)
    }
  }, [projectId])

  const selectedTask = tasks.find((t) => t.id === selectedTaskId)

  return (
    <div className="space-y-4">
      {/* PRD to Sprint Section */}
      <PRDInputSection
        projectId={projectId}
        members={members}
        sprints={sprints}
        onSprintCreated={handleSprintCreated}
        onTasksCreated={handleTasksCreatedFromPRD}
      />

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
          tasks={tasks.map(t => ({ id: t.id, key: t.key, title: t.title, type: t.type }))}
          availableContext={availableContext}
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
            onSprintUpdate={handleSprintUpdate}
            onSprintDelete={handleSprintDelete}
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
            onSprintUpdate={handleSprintUpdate}
            onSprintDelete={handleSprintDelete}
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

      <TaskDetailModal
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
