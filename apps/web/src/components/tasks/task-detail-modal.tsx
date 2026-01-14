'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { format, formatDistanceToNow } from 'date-fns'
import {
  Copy,
  Loader2,
  Send,
  Bug,
  Zap,
  BookOpen,
  FlaskConical,
  CheckSquare,
  Trash2,
  LayoutList,
  GitBranch,
  ChevronRight,
  ArrowUp,
  ArrowDown,
} from 'lucide-react'
import { SELECT_SENTINELS, assigneeSelect, sprintSelect, TASK_TYPE_HIERARCHY, VALID_PARENT_TYPES } from '@laneshare/shared'
import type { Task, Sprint, TaskComment, TaskActivity, TaskType, TaskStatus, TaskPriority, TaskLinkedContext, ContextSuggestionType, HierarchyLevel, TaskSummary } from '@laneshare/shared'
import { TaskContextFields } from './task-context-fields'

interface Member {
  id: string
  email: string
  full_name: string | null
  avatar_url?: string | null
}

interface TaskDetailModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: Task | null
  projectId: string
  members: Member[]
  sprints: Sprint[]
  repos: Array<{ id: string; owner: string; name: string }>
  onTaskUpdate: (task: Task) => void
  onTaskDelete: (taskId: string) => void
}

const TYPE_OPTIONS: { value: TaskType; label: string; Icon: React.ElementType; level: HierarchyLevel }[] = [
  { value: 'EPIC', label: 'Epic', Icon: Zap, level: 1 },
  { value: 'STORY', label: 'Story', Icon: BookOpen, level: 2 },
  { value: 'FEATURE', label: 'Feature', Icon: LayoutList, level: 3 },
  { value: 'TASK', label: 'Task', Icon: CheckSquare, level: 3 },
  { value: 'BUG', label: 'Bug', Icon: Bug, level: 3 },
  { value: 'SPIKE', label: 'Spike', Icon: FlaskConical, level: 3 },
  { value: 'SUBTASK', label: 'Sub-Task', Icon: GitBranch, level: 4 },
]

const NO_PARENT = '__NO_PARENT__'

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'BACKLOG', label: 'Backlog' },
  { value: 'TODO', label: 'To Do' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'IN_REVIEW', label: 'In Review' },
  { value: 'BLOCKED', label: 'Blocked' },
  { value: 'DONE', label: 'Done' },
]

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
]

export function TaskDetailModal({
  open,
  onOpenChange,
  task,
  projectId,
  members,
  sprints,
  repos,
  onTaskUpdate,
  onTaskDelete,
}: TaskDetailModalProps) {
  const { toast } = useToast()
  const router = useRouter()

  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<TaskType>('TASK')
  const [status, setStatus] = useState<TaskStatus>('TODO')
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM')
  const [assigneeId, setAssigneeId] = useState<string>(SELECT_SENTINELS.UNASSIGNED)
  const [sprintId, setSprintId] = useState<string>(SELECT_SENTINELS.NO_SPRINT)
  const [storyPoints, setStoryPoints] = useState<string>('')
  const [dueDate, setDueDate] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')

  // Comments and activity
  const [comments, setComments] = useState<TaskComment[]>([])
  const [activity, setActivity] = useState<TaskActivity[]>([])
  const [newComment, setNewComment] = useState('')
  const [isLoadingComments, setIsLoadingComments] = useState(false)
  const [isSendingComment, setIsSendingComment] = useState(false)

  // Linked context
  const [linkedContext, setLinkedContext] = useState<TaskLinkedContext>({
    services: [],
    assets: [],
    repos: [],
    docs: [],
    features: [],
    tickets: [],
    repoDocs: [],
  })
  const [availableContext, setAvailableContext] = useState<{
    services: Array<{ id: string; service: string; display_name: string }>
    assets: Array<{ id: string; name: string; asset_type: string; service: string }>
    repos: Array<{ id: string; owner: string; name: string }>
    docs: Array<{ id: string; slug: string; title: string; category?: string }>
    features: Array<{ id: string; feature_slug: string; feature_name: string; description?: string }>
    tickets: Array<{ id: string; key: string; title: string; status: TaskStatus; type: TaskType }>
  }>({
    services: [],
    assets: [],
    repos: [],
    docs: [],
    features: [],
    tickets: [],
  })
  const [isLoadingContext, setIsLoadingContext] = useState(false)

  // Parent/children hierarchy state
  const [parentTask, setParentTask] = useState<TaskSummary | null>(null)
  const [childTasks, setChildTasks] = useState<TaskSummary[]>([])
  const [parentTaskId, setParentTaskId] = useState<string>(NO_PARENT)

  // Calculate which types are valid based on parent/children constraints
  const validTypeOptions = useMemo(() => {
    return TYPE_OPTIONS.map((opt) => {
      const targetLevel = TASK_TYPE_HIERARCHY[opt.value]
      let disabled = false
      let reason = ''

      // Check parent constraint: new type must be a valid child of current parent
      if (parentTask) {
        const validParentTypes = VALID_PARENT_TYPES[targetLevel] || []
        if (!validParentTypes.includes(parentTask.type)) {
          disabled = true
          reason = `Cannot change to ${opt.label} - parent is ${parentTask.type}`
        }
      }

      // Check children constraint: new type must be a valid parent for all children
      if (childTasks.length > 0 && !disabled) {
        for (const child of childTasks) {
          const childLevel = TASK_TYPE_HIERARCHY[child.type]
          const validParentTypes = VALID_PARENT_TYPES[childLevel] || []
          if (!validParentTypes.includes(opt.value)) {
            disabled = true
            reason = `Cannot change to ${opt.label} - has ${child.type} children`
            break
          }
        }
      }

      return { ...opt, disabled, reason }
    })
  }, [parentTask, childTasks])

  // Reset form when task changes
  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDescription(task.description || '')
      setType(task.type)
      setStatus(task.status)
      setPriority(task.priority)
      setAssigneeId(assigneeSelect.encode(task.assignee_id))
      setSprintId(sprintSelect.encode(task.sprint_id))
      setStoryPoints(task.story_points?.toString() || '')
      setDueDate(task.due_date || '')
      setStartDate(task.start_date || '')
      setParentTaskId(task.parent_task_id || NO_PARENT)
      setIsEditing(false)

      // Load comments and activity
      loadCommentsAndActivity()
      // Load linked context
      loadLinkedContext()
      // Load available context for linking
      loadAvailableContext()
      // Load parent and children tasks
      loadHierarchy()
    }
  }, [task])

  const loadHierarchy = async () => {
    if (!task) return

    try {
      // Load parent task if exists
      if (task.parent_task_id) {
        const parentRes = await fetch(
          `/api/projects/${projectId}/tasks/${task.parent_task_id}`
        )
        if (parentRes.ok) {
          const parent = await parentRes.json()
          setParentTask({
            id: parent.id,
            key: parent.key,
            title: parent.title,
            type: parent.type,
            status: parent.status,
            hierarchy_level: parent.hierarchy_level,
          })
        }
      } else {
        setParentTask(null)
      }

      // Load child tasks
      const childrenRes = await fetch(
        `/api/projects/${projectId}/tasks?parent_task_id=${task.id}`
      )
      if (childrenRes.ok) {
        const children = await childrenRes.json()
        const childList = Array.isArray(children) ? children : []
        setChildTasks(
          childList.map((c: Task) => ({
            id: c.id,
            key: c.key,
            title: c.title,
            type: c.type,
            status: c.status,
            hierarchy_level: c.hierarchy_level,
          }))
        )
      } else {
        setChildTasks([])
      }
    } catch (error) {
      console.error('Failed to load hierarchy', error)
      setParentTask(null)
      setChildTasks([])
    }
  }

  const loadCommentsAndActivity = async () => {
    if (!task) return
    setIsLoadingComments(true)

    try {
      const [commentsRes, activityRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/tasks/${task.id}/comments`),
        fetch(`/api/projects/${projectId}/tasks/${task.id}/activity`),
      ])

      if (commentsRes.ok) {
        setComments(await commentsRes.json())
      }
      if (activityRes.ok) {
        setActivity(await activityRes.json())
      }
    } catch (error) {
      console.error('Failed to load comments/activity', error)
    } finally {
      setIsLoadingComments(false)
    }
  }

  const loadLinkedContext = async () => {
    if (!task) return

    try {
      const response = await fetch(
        `/api/projects/${projectId}/tasks/${task.id}/context`
      )
      if (response.ok) {
        setLinkedContext(await response.json())
      }
    } catch (error) {
      console.error('Failed to load linked context', error)
    }
  }

  const loadAvailableContext = async () => {
    if (!task) return
    setIsLoadingContext(true)

    try {
      const [servicesRes, assetsRes, docsRes, tasksRes, reposRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/services`),
        fetch(`/api/projects/${projectId}/services/assets`),
        fetch(`/api/projects/${projectId}/documents`),
        fetch(`/api/projects/${projectId}/tasks?limit=50`),
        fetch(`/api/projects/${projectId}/repos`),
      ])

      // Services API returns { connections: [...], user_role: ... }
      let services: Array<{ id: string; service: string; display_name: string }> = []
      if (servicesRes.ok) {
        const servicesData = await servicesRes.json()
        const connections = servicesData.connections || []
        services = connections
          .filter((s: { status: string }) => s.status === 'CONNECTED')
          .map((s: { id: string; service: string; display_name: string }) => ({
            id: s.id,
            service: s.service,
            display_name: s.display_name,
          }))
      }

      // Assets API returns { assets: [...], total, limit, offset }
      let assets: Array<{ id: string; name: string; asset_type: string; service: string }> = []
      if (assetsRes.ok) {
        const assetsData = await assetsRes.json()
        const assetsList = assetsData.assets || []
        assets = assetsList.map(
          (a: { id: string; name: string; asset_type: string; service: string }) => ({
            id: a.id,
            name: a.name,
            asset_type: a.asset_type,
            service: a.service,
          })
        )
      }

      // Docs API returns array directly
      let docs: Array<{ id: string; slug: string; title: string; category?: string }> = []
      if (docsRes.ok) {
        const docsData = await docsRes.json()
        const docsList = Array.isArray(docsData) ? docsData : []
        docs = docsList.map(
          (d: { id: string; slug: string; title: string; category?: string }) => ({
            id: d.id,
            slug: d.slug,
            title: d.title,
            category: d.category,
          })
        )
      }

      // Tasks API returns array directly
      let tickets: Array<{ id: string; key: string; title: string; status: TaskStatus; type: TaskType }> = []
      if (tasksRes.ok) {
        const tasksData = await tasksRes.json()
        const tasksList = Array.isArray(tasksData) ? tasksData : []
        tickets = tasksList
          .filter((t: { id: string }) => t.id !== task.id)
          .map((t: { id: string; key: string; title: string; status: TaskStatus; type: TaskType }) => ({
            id: t.id,
            key: t.key,
            title: t.title,
            status: t.status,
            type: t.type,
          }))
      }

      // Repos API returns array directly
      let fetchedRepos: Array<{ id: string; owner: string; name: string }> = []
      if (reposRes.ok) {
        const reposData = await reposRes.json()
        const reposList = Array.isArray(reposData) ? reposData : []
        fetchedRepos = reposList.map((r: { id: string; owner: string; name: string }) => ({
          id: r.id,
          owner: r.owner,
          name: r.name,
        }))
      }

      setAvailableContext({
        services,
        assets,
        repos: fetchedRepos,
        docs,
        features: [], // Features endpoint removed
        tickets,
      })
    } catch (error) {
      console.error('Failed to load available context', error)
    } finally {
      setIsLoadingContext(false)
    }
  }

  const handleLinkContext = async (type: ContextSuggestionType, id: string) => {
    if (!task) return

    const response = await fetch(
      `/api/projects/${projectId}/tasks/${task.id}/context`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id }),
      }
    )

    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Failed to link context')
    }

    // Reload linked context
    await loadLinkedContext()
  }

  const handleSave = async () => {
    if (!task) return
    setIsSaving(true)

    try {
      const response = await fetch(`/api/projects/${projectId}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: description || null,
          type,
          status,
          priority,
          assignee_id: assigneeSelect.decode(assigneeId),
          sprint_id: sprintSelect.decode(sprintId),
          story_points: storyPoints ? parseInt(storyPoints, 10) : null,
          due_date: dueDate || null,
          start_date: startDate || null,
          parent_task_id: parentTaskId === NO_PARENT ? null : parentTaskId,
        }),
      })

      if (!response.ok) throw new Error('Failed to update task')

      const updatedTask = await response.json()
      onTaskUpdate(updatedTask)
      setIsEditing(false)
      toast({ title: 'Task updated' })
      // Reload hierarchy after save
      loadHierarchy()
      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update task',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!task || !confirm('Are you sure you want to delete this task?')) return
    setIsDeleting(true)

    try {
      const response = await fetch(`/api/projects/${projectId}/tasks/${task.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to delete task')

      onTaskDelete(task.id)
      onOpenChange(false)
      toast({ title: 'Task deleted' })
      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to delete task',
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const handleSendComment = async () => {
    if (!task || !newComment.trim()) return
    setIsSendingComment(true)

    try {
      const response = await fetch(`/api/projects/${projectId}/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: newComment.trim() }),
      })

      if (!response.ok) throw new Error('Failed to send comment')

      const comment = await response.json()
      setComments((prev) => [...prev, comment])
      setNewComment('')
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to send comment',
      })
    } finally {
      setIsSendingComment(false)
    }
  }

  const handleCopyKey = () => {
    if (task) {
      navigator.clipboard.writeText(task.key)
      toast({ title: 'Copied to clipboard' })
    }
  }

  const handleQuickFieldChange = async (field: string, value: unknown) => {
    if (!task) return

    try {
      const response = await fetch(`/api/projects/${projectId}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })

      if (!response.ok) throw new Error('Failed to update')

      const updatedTask = await response.json()
      onTaskUpdate(updatedTask)

      // Update local state
      if (field === 'status') setStatus(value as TaskStatus)
      if (field === 'priority') setPriority(value as TaskPriority)
      if (field === 'assignee_id') setAssigneeId(assigneeSelect.encode(value as string | null))
      if (field === 'sprint_id') setSprintId(sprintSelect.encode(value as string | null))
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update task',
      })
    }
  }

  if (!task) return null

  const TypeIcon = TYPE_OPTIONS.find((t) => t.value === task.type)?.Icon || CheckSquare

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <TypeIcon className="h-5 w-5 text-muted-foreground" />
              <button
                onClick={handleCopyKey}
                className="font-mono text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                {task.key}
                <Copy className="h-3 w-3" />
              </button>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDelete}
              disabled={isDeleting}
              className="text-destructive hover:text-destructive"
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          </div>
          <DialogTitle className="text-left mt-2">
            {isEditing ? (
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-lg font-semibold"
              />
            ) : (
              <div
                className="cursor-pointer hover:bg-muted/50 rounded p-1 -m-1 text-xl"
                onClick={() => setIsEditing(true)}
              >
                {task.title}
              </div>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Two-column layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left column - Main content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Description */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Description</Label>
              {isEditing ? (
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="Add a description..."
                />
              ) : (
                <div
                  className="text-sm text-muted-foreground cursor-pointer hover:bg-muted/50 rounded p-2 -m-2 min-h-[80px]"
                  onClick={() => setIsEditing(true)}
                >
                  {task.description || 'Click to add description...'}
                </div>
              )}
            </div>

            {/* Additional fields when editing */}
            {isEditing && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Type</Label>
                    <Select value={type} onValueChange={(v) => setType(v as TaskType)}>
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {validTypeOptions.map((opt) => (
                          <SelectItem
                            key={opt.value}
                            value={opt.value}
                            disabled={opt.disabled}
                          >
                            <div className="flex items-center gap-2">
                              <opt.Icon className={cn('h-4 w-4', opt.disabled && 'opacity-50')} />
                              <span className={opt.disabled ? 'opacity-50' : ''}>
                                {opt.label}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Story Points</Label>
                    <Input
                      type="number"
                      value={storyPoints}
                      onChange={(e) => setStoryPoints(e.target.value)}
                      placeholder="0"
                      className="h-8"
                      min="0"
                      max="100"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Start Date</Label>
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="h-8"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Due Date</Label>
                    <Input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="h-8"
                    />
                  </div>
                </div>

                {/* Parent Task Selector when editing */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Parent Task</Label>
                  <Select
                    value={parentTaskId}
                    onValueChange={setParentTaskId}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="No parent" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PARENT}>No parent</SelectItem>
                      {availableContext.tickets
                        .filter((t) => {
                          const currentLevel = TASK_TYPE_HIERARCHY[type]
                          const validTypes = VALID_PARENT_TYPES[currentLevel] || []
                          return validTypes.includes(t.type) && t.id !== task.id
                        })
                        .map((t) => {
                          const TypeIcon = TYPE_OPTIONS.find((opt) => opt.value === t.type)?.Icon || CheckSquare
                          return (
                            <SelectItem key={t.id} value={t.id}>
                              <div className="flex items-center gap-2">
                                <TypeIcon className="h-4 w-4 text-muted-foreground" />
                                <span className="font-mono text-xs">{t.key}</span>
                                <span className="truncate max-w-[150px]">{t.title}</span>
                              </div>
                            </SelectItem>
                          )
                        })}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsEditing(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Save
                  </Button>
                </div>
              </>
            )}

            <Separator />

            {/* Comments and Activity tabs */}
            <Tabs defaultValue="comments">
              <TabsList className="w-full grid grid-cols-2">
                <TabsTrigger value="comments" className="text-xs">
                  Comments ({comments.length})
                </TabsTrigger>
                <TabsTrigger value="activity" className="text-xs">
                  Activity
                </TabsTrigger>
              </TabsList>

              <TabsContent value="comments" className="mt-4 space-y-4">
                {/* New comment input */}
                <div className="flex gap-2">
                  <Textarea
                    placeholder="Add a comment..."
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    rows={2}
                    className="flex-1"
                  />
                  <Button
                    size="icon"
                    onClick={handleSendComment}
                    disabled={isSendingComment || !newComment.trim()}
                  >
                    {isSendingComment ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>

                {/* Comments list */}
                {isLoadingComments ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : comments.length === 0 ? (
                  <div className="text-center py-4 text-sm text-muted-foreground">
                    No comments yet
                  </div>
                ) : (
                  <div className="space-y-4">
                    {comments.map((comment) => (
                      <div key={comment.id} className="flex gap-3">
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarImage src={comment.author?.avatar_url || undefined} />
                          <AvatarFallback className="text-xs">
                            {(comment.author?.full_name || comment.author?.email || '??')
                              .slice(0, 2)
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">
                              {comment.author?.full_name || comment.author?.email}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(comment.created_at), {
                                addSuffix: true,
                              })}
                            </span>
                          </div>
                          <p className="text-sm mt-1">{comment.body}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="activity" className="mt-4">
                {isLoadingComments ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : activity.length === 0 ? (
                  <div className="text-center py-4 text-sm text-muted-foreground">
                    No activity yet
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activity.map((item) => (
                      <div key={item.id} className="flex gap-3 text-sm">
                        <Avatar className="h-6 w-6 shrink-0">
                          <AvatarImage src={item.actor?.avatar_url || undefined} />
                          <AvatarFallback className="text-xs">
                            {(item.actor?.full_name || item.actor?.email || '??')
                              .slice(0, 2)
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <span className="font-medium">
                            {item.actor?.full_name || item.actor?.email}
                          </span>{' '}
                          <span className="text-muted-foreground">
                            {item.kind === 'CREATED' && 'created this task'}
                            {item.kind === 'STATUS_CHANGED' &&
                              `changed status from ${item.before_value} to ${item.after_value}`}
                            {item.kind === 'ASSIGNED' && `assigned this task`}
                            {item.kind === 'MOVED_SPRINT' && `moved to sprint`}
                            {item.kind === 'PRIORITY_CHANGED' &&
                              `changed priority from ${item.before_value} to ${item.after_value}`}
                            {item.kind === 'TYPE_CHANGED' &&
                              `changed type from ${item.before_value} to ${item.after_value}`}
                            {item.kind === 'PARENT_CHANGED' && 'updated parent task'}
                            {item.kind === 'COMMENTED' && `added a comment`}
                          </span>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {formatDistanceToNow(new Date(item.created_at), {
                              addSuffix: true,
                            })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* Right column - Metadata and context */}
          <div className="w-80 shrink-0 border-l overflow-y-auto p-6 space-y-6 bg-muted/5">
            {/* Quick fields */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Status</Label>
                <Select
                  value={status}
                  onValueChange={(v) => handleQuickFieldChange('status', v)}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Priority</Label>
                <Select
                  value={priority}
                  onValueChange={(v) => handleQuickFieldChange('priority', v)}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Assignee</Label>
                <Select
                  value={assigneeId}
                  onValueChange={(v) =>
                    handleQuickFieldChange('assignee_id', assigneeSelect.decode(v))
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_SENTINELS.UNASSIGNED}>Unassigned</SelectItem>
                    {members.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.full_name || member.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Sprint</Label>
                <Select
                  value={sprintId}
                  onValueChange={(v) =>
                    handleQuickFieldChange('sprint_id', sprintSelect.decode(v))
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="No Sprint" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_SENTINELS.NO_SPRINT}>No Sprint</SelectItem>
                    {sprints.map((sprint) => (
                      <SelectItem key={sprint.id} value={sprint.id}>
                        {sprint.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Hierarchy Section - Parent and Children */}
            {(parentTask || childTasks.length > 0) && (
              <>
                <div className="space-y-3">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <GitBranch className="h-4 w-4" />
                    Hierarchy
                  </Label>

                  {/* Parent Task Display */}
                  {parentTask && (
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground flex items-center gap-1">
                        <ArrowUp className="h-3 w-3" />
                        Parent
                      </Label>
                      <button
                        className="w-full text-left flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 border text-sm"
                        onClick={() => {
                          navigator.clipboard.writeText(parentTask.key)
                          toast({ title: `Copied ${parentTask.key}` })
                        }}
                      >
                        {(() => {
                          const ParentIcon = TYPE_OPTIONS.find((t) => t.value === parentTask.type)?.Icon || CheckSquare
                          return <ParentIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                        })()}
                        <span className="font-mono text-xs text-muted-foreground">{parentTask.key}</span>
                        <span className="truncate flex-1">{parentTask.title}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </button>
                    </div>
                  )}

                  {/* Children Tasks Display */}
                  {childTasks.length > 0 && (
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground flex items-center gap-1">
                        <ArrowDown className="h-3 w-3" />
                        Children ({childTasks.length})
                      </Label>
                      <div className="space-y-1 max-h-[150px] overflow-y-auto">
                        {childTasks.map((child) => {
                          const ChildIcon = TYPE_OPTIONS.find((t) => t.value === child.type)?.Icon || CheckSquare
                          return (
                            <button
                              key={child.id}
                              className="w-full text-left flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 border text-sm"
                              onClick={() => {
                                navigator.clipboard.writeText(child.key)
                                toast({ title: `Copied ${child.key}` })
                              }}
                            >
                              <ChildIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="font-mono text-xs text-muted-foreground">{child.key}</span>
                              <span className="truncate flex-1">{child.title}</span>
                              <Badge variant="outline" className="text-xs shrink-0">
                                {child.status.replace('_', ' ')}
                              </Badge>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
                <Separator />
              </>
            )}

            {/* Context Fields */}
            <TaskContextFields
              projectId={projectId}
              taskId={task.id}
              linkedContext={linkedContext}
              availableContext={availableContext}
              onContextChange={loadLinkedContext}
              parentTask={parentTask}
              childTasks={childTasks}
            />

            <Separator />

            {/* Metadata footer */}
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Created {format(new Date(task.created_at), 'MMM d, yyyy h:mm a')}</div>
              <div>Updated {format(new Date(task.updated_at), 'MMM d, yyyy h:mm a')}</div>
              {task.reporter && (
                <div>Reporter: {task.reporter.full_name || task.reporter.email}</div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
