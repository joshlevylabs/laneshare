import { createServerSupabaseClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatRelativeTime } from '@laneshare/shared'
import { GitBranch, ListTodo, FileText, MessageSquare, Users, Clock } from 'lucide-react'
import Link from 'next/link'

export default async function DashboardPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createServerSupabaseClient()

  // Fetch project stats in parallel
  const [reposResult, tasksResult, docsResult, threadsResult, membersResult] = await Promise.all([
    supabase.from('repos').select('*', { count: 'exact' }).eq('project_id', params.id),
    supabase.from('tasks').select('*', { count: 'exact' }).eq('project_id', params.id),
    supabase.from('doc_pages').select('*', { count: 'exact' }).eq('project_id', params.id),
    supabase.from('chat_threads').select('*', { count: 'exact' }).eq('project_id', params.id),
    supabase.from('project_members').select('*, profiles(email, full_name)').eq('project_id', params.id),
  ])

  const repos = reposResult.data || []
  const tasks = tasksResult.data || []
  const taskCounts = {
    backlog: tasks.filter((t) => t.status === 'BACKLOG').length,
    todo: tasks.filter((t) => t.status === 'TODO').length,
    inProgress: tasks.filter((t) => t.status === 'IN_PROGRESS').length,
    done: tasks.filter((t) => t.status === 'DONE').length,
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          Overview of your project's status and activity
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Link href={`/projects/${params.id}/repos`}>
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Repositories</CardTitle>
              <GitBranch className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{reposResult.count || 0}</div>
              <p className="text-xs text-muted-foreground">
                {repos.filter((r) => r.status === 'SYNCED').length} synced
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href={`/projects/${params.id}/tasks`}>
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Tasks</CardTitle>
              <ListTodo className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{tasksResult.count || 0}</div>
              <p className="text-xs text-muted-foreground">
                {taskCounts.inProgress} in progress
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href={`/projects/${params.id}/docs`}>
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Documentation</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{docsResult.count || 0}</div>
              <p className="text-xs text-muted-foreground">pages</p>
            </CardContent>
          </Card>
        </Link>

        <Link href={`/projects/${params.id}/chat`}>
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Chat Threads</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{threadsResult.count || 0}</div>
              <p className="text-xs text-muted-foreground">conversations</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Recent Repositories */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Repositories</CardTitle>
            <CardDescription>Connected repositories and sync status</CardDescription>
          </CardHeader>
          <CardContent>
            {repos.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No repositories connected yet.{' '}
                <Link href={`/projects/${params.id}/repos`} className="text-primary hover:underline">
                  Add one now
                </Link>
              </p>
            ) : (
              <div className="space-y-3">
                {repos.slice(0, 5).map((repo) => (
                  <div key={repo.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">
                        {repo.owner}/{repo.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          repo.status === 'SYNCED'
                            ? 'success'
                            : repo.status === 'ERROR'
                            ? 'destructive'
                            : 'secondary'
                        }
                      >
                        {repo.status}
                      </Badge>
                      {repo.last_synced_at && (
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(repo.last_synced_at)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Task Progress */}
        <Card>
          <CardHeader>
            <CardTitle>Task Progress</CardTitle>
            <CardDescription>Current sprint status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Backlog</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-slate-400"
                      style={{
                        width: `${tasks.length > 0 ? (taskCounts.backlog / tasks.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-sm text-muted-foreground w-8">{taskCounts.backlog}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">To Do</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500"
                      style={{
                        width: `${tasks.length > 0 ? (taskCounts.todo / tasks.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-sm text-muted-foreground w-8">{taskCounts.todo}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">In Progress</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-yellow-500"
                      style={{
                        width: `${tasks.length > 0 ? (taskCounts.inProgress / tasks.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-sm text-muted-foreground w-8">{taskCounts.inProgress}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Done</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500"
                      style={{
                        width: `${tasks.length > 0 ? (taskCounts.done / tasks.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-sm text-muted-foreground w-8">{taskCounts.done}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Team Members */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Team Members
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(membersResult.data || []).map((member: any) => (
                <div key={member.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-sm font-medium">
                        {(member.profiles?.full_name || member.profiles?.email || '?')[0].toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {member.profiles?.full_name || member.profiles?.email}
                      </p>
                      {member.profiles?.full_name && (
                        <p className="text-xs text-muted-foreground">{member.profiles.email}</p>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline">{member.role}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link
              href={`/projects/${params.id}/repos`}
              className="block p-3 rounded-md bg-muted hover:bg-muted/80 transition-colors"
            >
              <span className="text-sm font-medium">Connect a Repository</span>
              <p className="text-xs text-muted-foreground">Add GitHub repos to your project</p>
            </Link>
            <Link
              href={`/projects/${params.id}/tasks`}
              className="block p-3 rounded-md bg-muted hover:bg-muted/80 transition-colors"
            >
              <span className="text-sm font-medium">Create a Task</span>
              <p className="text-xs text-muted-foreground">Add new items to your backlog</p>
            </Link>
            <Link
              href={`/projects/${params.id}/chat`}
              className="block p-3 rounded-md bg-muted hover:bg-muted/80 transition-colors"
            >
              <span className="text-sm font-medium">Start a LanePilot Chat</span>
              <p className="text-xs text-muted-foreground">Generate context packs and prompts</p>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
