import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ImplementationProgress } from '@/components/tasks/implementation-progress'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

interface PageProps {
  params: { id: string; taskId: string }
}

export default async function ImplementationStatusPage({ params }: PageProps) {
  const projectId = params.id
  const taskId = params.taskId
  const supabase = createServerSupabaseClient()

  // Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // Check project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    redirect('/projects')
  }

  // Get task info
  const { data: task } = await supabase
    .from('tasks')
    .select('id, key, title, status')
    .eq('id', taskId)
    .eq('project_id', projectId)
    .single()

  if (!task) {
    redirect(`/projects/${projectId}/tasks`)
  }

  // Get project info
  const { data: project } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', projectId)
    .single()

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/projects/${projectId}/tasks`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Tasks
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold">
          Implementation Status
        </h1>
        <p className="text-muted-foreground mt-1">
          <span className="font-mono">{task.key}</span> - {task.title}
        </p>
      </div>

      {/* Progress Component */}
      <ImplementationProgress
        projectId={projectId}
        taskId={taskId}
      />
    </div>
  )
}
