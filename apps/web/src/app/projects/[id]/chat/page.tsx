import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ChatInterface } from '@/components/chat/chat-interface'

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { taskId?: string; threadId?: string }
}) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Fetch threads
  const { data: threads } = await supabase
    .from('chat_threads')
    .select('*')
    .eq('project_id', params.id)
    .order('updated_at', { ascending: false })

  // Fetch tasks for task selector
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, status, priority')
    .eq('project_id', params.id)
    .order('created_at', { ascending: false })

  // Fetch repos for context
  const { data: repos } = await supabase
    .from('repos')
    .select('id, owner, name')
    .eq('project_id', params.id)
    .eq('status', 'SYNCED')

  // If there's a threadId, fetch messages
  let messages: any[] = []
  let activeThread: any = null

  if (searchParams.threadId) {
    const { data: thread } = await supabase
      .from('chat_threads')
      .select('*')
      .eq('id', searchParams.threadId)
      .eq('project_id', params.id)
      .single()

    if (thread) {
      activeThread = thread

      const { data: threadMessages } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('thread_id', searchParams.threadId)
        .order('created_at', { ascending: true })

      messages = threadMessages || []
    }
  }

  // If there's a taskId, find the task
  let selectedTask: any = null
  if (searchParams.taskId) {
    selectedTask = tasks?.find((t) => t.id === searchParams.taskId)
  }

  return (
    <div className="h-[calc(100vh-8rem)]">
      <ChatInterface
        projectId={params.id}
        userId={user?.id || ''}
        threads={threads || []}
        tasks={tasks || []}
        repos={repos || []}
        initialThread={activeThread}
        initialMessages={messages}
        initialTask={selectedTask}
      />
    </div>
  )
}
