import { createServerSupabaseClient } from '@/lib/supabase/server'
import { TaskBoard } from '@/components/tasks/task-board'
import { CreateTaskDialog } from '@/components/tasks/create-task-dialog'

export default async function TasksPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createServerSupabaseClient()

  const { data: tasks } = await supabase
    .from('tasks')
    .select('*, profiles:assignee_id(id, email, full_name)')
    .eq('project_id', params.id)
    .order('position', { ascending: true })

  const { data: members } = await supabase
    .from('project_members')
    .select('*, profiles(id, email, full_name)')
    .eq('project_id', params.id)

  const { data: repos } = await supabase
    .from('repos')
    .select('id, owner, name')
    .eq('project_id', params.id)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tasks</h1>
          <p className="text-muted-foreground">
            Manage and track project tasks with drag-and-drop
          </p>
        </div>
        <CreateTaskDialog
          projectId={params.id}
          members={members?.map((m: any) => m.profiles) || []}
          repos={repos || []}
        />
      </div>

      <TaskBoard
        projectId={params.id}
        initialTasks={tasks || []}
        members={members?.map((m: any) => m.profiles) || []}
      />
    </div>
  )
}
