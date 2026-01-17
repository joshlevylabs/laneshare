'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Progress } from '@/components/ui/progress'
import {
  ArrowLeft,
  MessageSquare,
  TreePine,
  Settings,
  MoreVertical,
  Play,
  Pause,
  Archive,
  Trash2,
  CheckCircle2,
  Sparkles,
  GitBranch,
  Layers,
  RefreshCw,
  Loader2,
  Link2,
  FileText,
  Box,
} from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { SidequestPlanningChat } from './planning/sidequest-planning-chat'
import { PlanTreeView } from './plan-tree/plan-tree-view'
import type { Sidequest, SidequestTicket } from '@laneshare/shared'

interface SidequestDetailProps {
  projectId: string
  sidequest: Sidequest & { tickets?: SidequestTicket[] }
  repos: Array<{ id: string; owner: string; name: string; default_branch?: string }>
  docs: Array<{ id: string; title: string; slug: string; category?: string }>
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  PLANNING: { label: 'Planning', variant: 'secondary' },
  READY: { label: 'Ready', variant: 'default' },
  IN_PROGRESS: { label: 'In Progress', variant: 'default' },
  PAUSED: { label: 'Paused', variant: 'outline' },
  COMPLETED: { label: 'Completed', variant: 'secondary' },
  ARCHIVED: { label: 'Archived', variant: 'outline' },
}

export function SidequestDetail({
  projectId,
  sidequest: initialSidequest,
  repos,
  docs,
}: SidequestDetailProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [sidequest, setSidequest] = useState(initialSidequest)
  const [tickets, setTickets] = useState<SidequestTicket[]>(initialSidequest.tickets || [])
  const [activeTab, setActiveTab] = useState<string>(
    sidequest.status === 'PLANNING' ? 'chat' : 'plan'
  )
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [isOrganizing, setIsOrganizing] = useState(false)
  const [isAddingContext, setIsAddingContext] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const statusConfig = STATUS_CONFIG[sidequest.status] || STATUS_CONFIG.PLANNING
  const progress =
    sidequest.total_tickets > 0
      ? Math.round((sidequest.completed_tickets / sidequest.total_tickets) * 100)
      : 0

  const pendingTickets = tickets.filter((t) => t.status === 'PENDING').length
  const approvedTickets = tickets.filter((t) => t.status === 'APPROVED' || t.status === 'COMPLETED').length
  const ticketsWithContext = tickets.filter(
    (t) => (t.linked_doc_ids && t.linked_doc_ids.length > 0) ||
           (t.linked_repo_ids && t.linked_repo_ids.length > 0) ||
           (t.linked_feature_ids && t.linked_feature_ids.length > 0)
  ).length

  // Refresh tickets
  const refreshTickets = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/sidequests/${sidequest.id}/tickets`
      )
      if (!response.ok) throw new Error('Failed to refresh')
      const data = await response.json()
      setTickets(data.tickets || [])
    } catch (error) {
      console.error('Refresh error:', error)
      toast({ title: 'Error', description: 'Failed to refresh tickets', variant: 'destructive' })
    } finally {
      setIsRefreshing(false)
    }
  }, [projectId, sidequest.id, toast])

  // Organize sprints
  const handleOrganizeSprints = async () => {
    setIsOrganizing(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/sidequests/${sidequest.id}/organize-sprints`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ strategy: 'balanced' }),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to organize')
      }

      const result = await response.json()
      toast({ title: 'Success', description: `Organized into ${result.total_sprints} sprints` })
      await refreshTickets()
    } catch (error) {
      console.error('Organize error:', error)
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to organize sprints', variant: 'destructive' })
    } finally {
      setIsOrganizing(false)
    }
  }

  // Add context to all tickets
  const handleAddContext = async () => {
    setIsAddingContext(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/sidequests/${sidequest.id}/analyze-all-context`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to analyze context')
      }

      const result = await response.json()
      const linked = result.linked || { docs: 0, repos: 0, features: 0 }
      const linkedTotal = linked.docs + linked.repos + linked.features
      toast({
        title: 'Context Added',
        description: `Analyzed ${result.analyzed || 0} tickets. Linked ${linkedTotal} resources (${linked.docs} docs, ${linked.repos} repos, ${linked.features} features)`,
      })
      await refreshTickets()
    } catch (error) {
      console.error('Add context error:', error)
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to add context', variant: 'destructive' })
    } finally {
      setIsAddingContext(false)
    }
  }

  // Finalize plan
  const handleFinalizePlan = async () => {
    if (pendingTickets > 0) {
      toast({ title: 'Cannot Finalize', description: `Please approve all tickets first (${pendingTickets} pending)`, variant: 'destructive' })
      return
    }

    setIsFinalizing(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/sidequests/${sidequest.id}/finalize-plan`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            create_sprint: true,
            sprint_name: `${sidequest.title} Sprint`,
          }),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to finalize')
      }

      const result = await response.json()
      toast({ title: 'Success', description: `Created ${result.tasks_created} tasks` })

      // Refresh sidequest data
      const sqResponse = await fetch(
        `/api/projects/${projectId}/sidequests/${sidequest.id}`
      )
      if (sqResponse.ok) {
        const sqData = await sqResponse.json()
        setSidequest(sqData)
        setTickets(sqData.tickets || [])
      }
    } catch (error) {
      console.error('Finalize error:', error)
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to finalize plan', variant: 'destructive' })
    } finally {
      setIsFinalizing(false)
    }
  }

  // Start implementation
  const handleStartImplementation = async () => {
    try {
      const response = await fetch(
        `/api/projects/${projectId}/sidequests/${sidequest.id}/implement`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auto_advance: false }),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to start')
      }

      toast({ title: 'Success', description: 'Implementation started' })
      router.push(`/projects/${projectId}/sidequests/${sidequest.id}/implement`)
    } catch (error) {
      console.error('Start implementation error:', error)
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to start implementation', variant: 'destructive' })
    }
  }

  // Delete sidequest
  const handleDelete = async () => {
    try {
      const response = await fetch(
        `/api/projects/${projectId}/sidequests/${sidequest.id}`,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete')
      }

      toast({ title: 'Deleted', description: 'Sidequest deleted' })
      router.push(`/projects/${projectId}/sidequests`)
    } catch (error) {
      console.error('Delete error:', error)
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to delete', variant: 'destructive' })
    }
    setDeleteDialogOpen(false)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push(`/projects/${projectId}/sidequests`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{sidequest.title}</h1>
              <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
            </div>
            {sidequest.description && (
              <p className="text-muted-foreground mt-1">{sidequest.description}</p>
            )}
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <GitBranch className="h-4 w-4" />
                {sidequest.repos?.length || 0} repos
              </span>
              <span className="flex items-center gap-1">
                <Layers className="h-4 w-4" />
                {tickets.length} tickets
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {sidequest.status === 'READY' && (
            <Button onClick={handleStartImplementation}>
              <Play className="h-4 w-4 mr-2" />
              Implement
            </Button>
          )}
          {sidequest.status === 'IN_PROGRESS' && (
            <Button onClick={() => router.push(`/projects/${projectId}/sidequests/${sidequest.id}/implement`)}>
              <Play className="h-4 w-4 mr-2" />
              Continue Implementation
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={refreshTickets} disabled={isRefreshing}>
                <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Progress */}
      {sidequest.total_tickets > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Progress</span>
              <span className="text-sm text-muted-foreground">
                {sidequest.completed_tickets} / {sidequest.total_tickets} completed
              </span>
            </div>
            <Progress value={progress} className="h-2" />
            <div className="flex gap-4 mt-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <span>{pendingTickets} pending</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>{approvedTickets} approved</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main content - Side by side during PLANNING, tabs otherwise */}
      {sidequest.status === 'PLANNING' ? (
        // Side-by-side view during planning
        <div className="space-y-4">
          {/* Action buttons */}
          {tickets.length > 0 && (
            <div className="flex items-center justify-between">
              {/* Context info */}
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Link2 className="h-4 w-4" />
                  {ticketsWithContext}/{tickets.length} with context
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handleAddContext}
                  disabled={isAddingContext}
                >
                  {isAddingContext ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Link2 className="h-4 w-4 mr-2" />
                  )}
                  Add Context
                </Button>
                <Button
                  variant="outline"
                  onClick={handleOrganizeSprints}
                  disabled={isOrganizing}
                >
                  {isOrganizing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  Organize Sprints
                </Button>
                <Button
                  onClick={handleFinalizePlan}
                  disabled={isFinalizing || pendingTickets > 0}
                >
                  {isFinalizing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                  )}
                  Finalize Plan
                </Button>
              </div>
            </div>
          )}

          {/* Side-by-side panels */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Chat panel */}
            <Card className="h-[600px]">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Planning Chat
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[calc(100%-60px)]">
                <SidequestPlanningChat
                  sidequestId={sidequest.id}
                  projectId={projectId}
                  onPlanUpdated={refreshTickets}
                />
              </CardContent>
            </Card>

            {/* Plan tree panel */}
            <Card className="h-[600px] overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <TreePine className="h-4 w-4" />
                  Plan
                  {tickets.length > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {tickets.length} tickets
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[calc(100%-60px)] overflow-auto">
                {tickets.length > 0 ? (
                  <PlanTreeView
                    sidequestId={sidequest.id}
                    projectId={projectId}
                    tickets={tickets}
                    onRefresh={refreshTickets}
                    readonly={false}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                    <TreePine className="h-12 w-12 mb-4 opacity-30" />
                    <p className="text-center">No tickets yet.</p>
                    <p className="text-sm text-center mt-1">
                      Chat with the AI to start building your plan!
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        // Tabs view for other statuses
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="chat" className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Chat
              </TabsTrigger>
              <TabsTrigger value="plan" className="flex items-center gap-2">
                <TreePine className="h-4 w-4" />
                Plan
                {tickets.length > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {tickets.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {activeTab === 'plan' && tickets.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground flex items-center gap-1 mr-2">
                  <Link2 className="h-4 w-4" />
                  {ticketsWithContext}/{tickets.length} with context
                </span>
                <Button
                  variant="outline"
                  onClick={handleAddContext}
                  disabled={isAddingContext}
                >
                  {isAddingContext ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Link2 className="h-4 w-4 mr-2" />
                  )}
                  Add Context
                </Button>
                {sidequest.status === 'READY' && (
                  <>
                    <Button
                      variant="outline"
                      onClick={handleOrganizeSprints}
                      disabled={isOrganizing}
                    >
                      {isOrganizing ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      Organize Sprints
                    </Button>
                    <Button
                      onClick={handleFinalizePlan}
                      disabled={isFinalizing || pendingTickets > 0}
                    >
                      {isFinalizing ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                      )}
                      Finalize Plan
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>

          <TabsContent value="chat" className="mt-4">
            <Card className="h-[600px]">
              <CardContent className="h-full py-4">
                <SidequestPlanningChat
                  sidequestId={sidequest.id}
                  projectId={projectId}
                  onPlanUpdated={refreshTickets}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="plan" className="mt-4">
            <PlanTreeView
              sidequestId={sidequest.id}
              projectId={projectId}
              tickets={tickets}
              onRefresh={refreshTickets}
              readonly={sidequest.status === 'COMPLETED' || sidequest.status === 'ARCHIVED'}
            />
          </TabsContent>
        </Tabs>
      )}

      {/* Delete dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Sidequest?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{sidequest.title}&quot; and all its tickets. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
