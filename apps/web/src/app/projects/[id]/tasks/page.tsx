import { createServerSupabaseClient } from '@/lib/supabase/server'
import { TasksLayout } from '@/components/tasks/tasks-layout'
import type { Task, Sprint } from '@laneshare/shared'

interface ProfileRow {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
}

interface TaskRow {
  id: string
  key?: string | null
  title: string
  description: string | null
  type?: string
  status: string
  priority: string
  assignee_id: string | null
  reporter_id?: string | null
  sprint_id?: string | null
  story_points?: number | null
  labels?: string[] | null
  due_date?: string | null
  start_date?: string | null
  parent_task_id?: string | null
  rank?: number
  position?: number
  project_id: string
  created_at: string
  updated_at: string
  assignee: ProfileRow | null
  reporter?: ProfileRow | null
  sprint?: { id: string; name: string } | null
}

interface SprintRow {
  id: string
  name: string
  goal?: string | null
  status?: string
  start_date: string | null
  end_date: string | null
  project_id: string
  created_at: string
  updated_at?: string
}

export default async function TasksPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createServerSupabaseClient()

  // Fetch tasks with relations (backward compatible query)
  // Note: reporter_id and sprint_id joins require the migration to be applied
  const { data: tasksData, error: tasksError } = await supabase
    .from('tasks')
    .select(`
      *,
      assignee:profiles!assignee_id(id, email, full_name, avatar_url)
    `)
    .eq('project_id', params.id)
    .order('position', { ascending: true })

  // Fetch sprints
  const { data: sprintsData } = await supabase
    .from('sprints')
    .select('*')
    .eq('project_id', params.id)
    .order('created_at', { ascending: false })

  // Fetch members
  const { data: members } = await supabase
    .from('project_members')
    .select('*, profiles(id, email, full_name, avatar_url)')
    .eq('project_id', params.id)

  // Fetch repos
  const { data: repos } = await supabase
    .from('repos')
    .select('id, owner, name')
    .eq('project_id', params.id)

  // Transform tasks to match the Task type (backward compatible)
  const tasks: Task[] = (tasksData as TaskRow[] | null)?.map((t, index) => ({
    id: t.id,
    key: t.key || `TASK-${t.id.slice(0, 4).toUpperCase()}`,
    title: t.title,
    description: t.description ?? undefined,
    type: (t.type as Task['type']) || 'TASK',
    status: t.status as Task['status'],
    priority: t.priority as Task['priority'],
    assignee_id: t.assignee_id ?? undefined,
    reporter_id: t.reporter_id ?? undefined,
    sprint_id: t.sprint_id ?? undefined,
    story_points: t.story_points ?? undefined,
    labels: t.labels || [],
    due_date: t.due_date ?? undefined,
    start_date: t.start_date ?? undefined,
    parent_task_id: t.parent_task_id ?? undefined,
    rank: t.rank ?? t.position ?? index,
    project_id: t.project_id,
    created_at: t.created_at,
    updated_at: t.updated_at,
    assignee: t.assignee ? {
      id: t.assignee.id,
      email: t.assignee.email,
      full_name: t.assignee.full_name ?? undefined,
      avatar_url: t.assignee.avatar_url ?? undefined,
    } : undefined,
    reporter: t.reporter ? {
      id: t.reporter.id,
      email: t.reporter.email,
      full_name: t.reporter.full_name ?? undefined,
      avatar_url: t.reporter.avatar_url ?? undefined,
    } : undefined,
  })) || []

  // Transform sprints to match the Sprint type (backward compatible)
  const sprints: Sprint[] = (sprintsData as SprintRow[] | null)?.map((s) => ({
    id: s.id,
    name: s.name,
    goal: s.goal ?? undefined,
    status: (s.status as Sprint['status']) || 'PLANNED',
    start_date: s.start_date ?? undefined,
    end_date: s.end_date ?? undefined,
    project_id: s.project_id,
    created_at: s.created_at,
    updated_at: s.updated_at,
  })) || []

  // Extract member profiles
  const memberProfiles = members?.map((m: any) => ({
    id: m.profiles.id,
    email: m.profiles.email,
    full_name: m.profiles.full_name,
    avatar_url: m.profiles.avatar_url,
  })) || []

  return (
    <TasksLayout
      projectId={params.id}
      initialTasks={tasks}
      sprints={sprints}
      members={memberProfiles}
      repos={repos || []}
    />
  )
}
