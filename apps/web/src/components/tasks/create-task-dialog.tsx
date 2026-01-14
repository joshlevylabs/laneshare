'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useToast } from '@/hooks/use-toast'
import {
  Loader2, Plus, Bug, Zap, BookOpen, FlaskConical, CheckSquare, LayoutList, GitBranch,
  ChevronDown, ChevronRight, Server, Table2, FileText, Workflow, Ticket, X,
  Link2, ArrowRight, ArrowLeft, Copy
} from 'lucide-react'
import { SELECT_SENTINELS, assigneeSelect, sprintSelect, TASK_TYPE_HIERARCHY, VALID_PARENT_TYPES } from '@laneshare/shared'
import type { Task, Sprint, TaskType, TaskStatus, TaskPriority, HierarchyLevel, TicketLinkType } from '@laneshare/shared'
import { cn } from '@/lib/utils'

interface Member {
  id: string
  email: string
  full_name: string | null
}

interface Repo {
  id: string
  owner: string
  name: string
}

interface ParentTask {
  id: string
  key: string
  title: string
  type: TaskType
}

interface AvailableContext {
  services: Array<{ id: string; service: string; display_name: string }>
  assets: Array<{ id: string; name: string; asset_type: string; service: string }>
  docs: Array<{ id: string; slug: string; title: string; category?: string }>
  features: Array<{ id: string; feature_slug: string; feature_name: string; description?: string }>
  tickets: Array<{ id: string; key: string; title: string; status: string; type: TaskType }>
}

interface TicketSelection {
  id: string
  linkType: TicketLinkType
}

interface CreateTaskDialogProps {
  projectId: string
  members: Member[]
  repos: Repo[]
  sprints?: Sprint[]
  tasks?: ParentTask[]
  availableContext?: AvailableContext
  defaultParentId?: string
  defaultType?: TaskType
  onTaskCreated?: (task: Task) => void
}

const TICKET_LINK_OPTIONS: { value: TicketLinkType; label: string }[] = [
  { value: 'related', label: 'Related to' },
  { value: 'blocks', label: 'Blocks' },
  { value: 'blocked_by', label: 'Blocked by' },
  { value: 'duplicates', label: 'Duplicates' },
  { value: 'duplicated_by', label: 'Duplicated by' },
]

const TICKET_LINK_LABELS: Record<TicketLinkType, { label: string; icon: React.ReactNode }> = {
  related: { label: 'Related', icon: <Link2 className="h-3 w-3" /> },
  blocks: { label: 'Blocks', icon: <ArrowRight className="h-3 w-3" /> },
  blocked_by: { label: 'Blocked by', icon: <ArrowLeft className="h-3 w-3" /> },
  duplicates: { label: 'Duplicates', icon: <Copy className="h-3 w-3" /> },
  duplicated_by: { label: 'Duplicated by', icon: <Copy className="h-3 w-3" /> },
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

export function CreateTaskDialog({
  projectId,
  members,
  repos,
  sprints = [],
  tasks = [],
  availableContext,
  defaultParentId,
  defaultType,
  onTaskCreated,
}: CreateTaskDialogProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<TaskType>(defaultType || 'TASK')
  const [status, setStatus] = useState<TaskStatus>('TODO')
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM')
  const [assigneeId, setAssigneeId] = useState<string>(SELECT_SENTINELS.UNASSIGNED)
  const [sprintId, setSprintId] = useState<string>(SELECT_SENTINELS.NO_SPRINT)
  const [storyPoints, setStoryPoints] = useState<string>('')
  const [parentTaskId, setParentTaskId] = useState<string>(defaultParentId || NO_PARENT)

  // Context selection state
  const [selectedRepos, setSelectedRepos] = useState<string[]>([])
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [selectedAssets, setSelectedAssets] = useState<string[]>([])
  const [selectedDocs, setSelectedDocs] = useState<string[]>([])
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([])
  const [selectedTickets, setSelectedTickets] = useState<TicketSelection[]>([])
  const [ticketLinkType, setTicketLinkType] = useState<TicketLinkType>('related')

  // Context section open states
  const [contextOpen, setContextOpen] = useState(false)

  // Popover states
  const [repoPopoverOpen, setRepoPopoverOpen] = useState(false)
  const [servicePopoverOpen, setServicePopoverOpen] = useState(false)
  const [assetPopoverOpen, setAssetPopoverOpen] = useState(false)
  const [docPopoverOpen, setDocPopoverOpen] = useState(false)
  const [featurePopoverOpen, setFeaturePopoverOpen] = useState(false)
  const [ticketPopoverOpen, setTicketPopoverOpen] = useState(false)

  // Get valid parent types for the current task type
  const hierarchyLevel = TASK_TYPE_HIERARCHY[type]
  const validParentTypes = VALID_PARENT_TYPES[hierarchyLevel] || []

  // Filter available parent tasks based on valid parent types
  const availableParents = useMemo(() => {
    if (validParentTypes.length === 0) return []
    return tasks.filter((t) => validParentTypes.includes(t.type))
  }, [tasks, validParentTypes])

  // Reset parent if no longer valid when type changes
  useEffect(() => {
    if (parentTaskId !== NO_PARENT) {
      const parentTask = tasks.find((t) => t.id === parentTaskId)
      if (parentTask && !validParentTypes.includes(parentTask.type)) {
        setParentTaskId(NO_PARENT)
      }
    }
  }, [type, parentTaskId, tasks, validParentTypes])

  // Compute total context count for badge
  const totalContextCount = selectedRepos.length + selectedServices.length + selectedAssets.length +
    selectedDocs.length + selectedFeatures.length + selectedTickets.length

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    setIsLoading(true)

    try {
      const response = await fetch(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          type,
          status,
          priority,
          assignee_id: assigneeSelect.decode(assigneeId),
          sprint_id: sprintSelect.decode(sprintId),
          story_points: storyPoints ? parseInt(storyPoints, 10) : null,
          parent_task_id: parentTaskId === NO_PARENT ? null : parentTaskId,
          // Context links
          context_repos: selectedRepos.length > 0 ? selectedRepos : undefined,
          context_services: selectedServices.length > 0 ? selectedServices : undefined,
          context_assets: selectedAssets.length > 0 ? selectedAssets : undefined,
          context_docs: selectedDocs.length > 0 ? selectedDocs : undefined,
          context_features: selectedFeatures.length > 0 ? selectedFeatures : undefined,
          context_tickets: selectedTickets.length > 0 ? selectedTickets : undefined,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to create task')
      }

      const task = await response.json()

      toast({
        title: 'Task created',
        description: `${task.key}: "${title}" has been added.`,
      })

      if (onTaskCreated) {
        onTaskCreated(task)
      }

      setOpen(false)
      resetForm()
      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create task',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const resetForm = () => {
    setTitle('')
    setDescription('')
    setType(defaultType || 'TASK')
    setStatus('TODO')
    setPriority('MEDIUM')
    setAssigneeId(SELECT_SENTINELS.UNASSIGNED)
    setSprintId(SELECT_SENTINELS.NO_SPRINT)
    setStoryPoints('')
    setParentTaskId(defaultParentId || NO_PARENT)
    // Reset context selections
    setSelectedRepos([])
    setSelectedServices([])
    setSelectedAssets([])
    setSelectedDocs([])
    setSelectedFeatures([])
    setSelectedTickets([])
    setContextOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New Task
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Task</DialogTitle>
            <DialogDescription>
              Add a new task to the project.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder="Task title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                placeholder="Describe the task..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={type} onValueChange={(v) => setType(v as TaskType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <div className="flex items-center gap-2">
                          <opt.Icon className="h-4 w-4" />
                          {opt.label}
                          <span className="text-xs text-muted-foreground ml-1">
                            (L{opt.level})
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                  <SelectTrigger>
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
            </div>

            {/* Parent Task Selection - only shown when valid parents exist */}
            {availableParents.length > 0 && (
              <div className="space-y-2">
                <Label>
                  Parent {validParentTypes.length === 1 ? TYPE_OPTIONS.find((t) => t.value === validParentTypes[0])?.label : 'Task'} (optional)
                </Label>
                <Select value={parentTaskId} onValueChange={setParentTaskId}>
                  <SelectTrigger>
                    <SelectValue placeholder="No parent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PARENT}>No parent</SelectItem>
                    {availableParents.map((task) => {
                      const typeOpt = TYPE_OPTIONS.find((t) => t.value === task.type)
                      return (
                        <SelectItem key={task.id} value={task.id}>
                          <div className="flex items-center gap-2">
                            {typeOpt && <typeOpt.Icon className="h-4 w-4 text-muted-foreground" />}
                            <span className="font-mono text-xs">{task.key}</span>
                            <span className="truncate max-w-[200px]">{task.title}</span>
                          </div>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {type === 'STORY' && 'Stories can be children of Epics'}
                  {['FEATURE', 'TASK', 'BUG', 'SPIKE'].includes(type) && 'Can be children of Epics or Stories'}
                  {type === 'SUBTASK' && 'Sub-tasks must have a parent Task, Feature, Bug, or Spike'}
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                  <SelectTrigger>
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

              <div className="space-y-2">
                <Label>Story Points</Label>
                <Input
                  type="number"
                  placeholder="0"
                  value={storyPoints}
                  onChange={(e) => setStoryPoints(e.target.value)}
                  min="0"
                  max="100"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Assignee (optional)</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger>
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

            {sprints.length > 0 && (
              <div className="space-y-2">
                <Label>Sprint (optional)</Label>
                <Select value={sprintId} onValueChange={setSprintId}>
                  <SelectTrigger>
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
            )}

            {/* Context Section */}
            {availableContext && (
              <Collapsible open={contextOpen} onOpenChange={setContextOpen}>
                <div className="border rounded-md">
                  <CollapsibleTrigger className="flex items-center gap-2 w-full p-3 hover:bg-muted/50 rounded-md">
                    {contextOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium">Context (optional)</span>
                    {totalContextCount > 0 && (
                      <Badge variant="secondary" className="ml-auto">
                        {totalContextCount} linked
                      </Badge>
                    )}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="p-3 pt-0 space-y-3">
                      {/* Repositories */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs flex items-center gap-1.5">
                            <GitBranch className="h-3.5 w-3.5 text-green-600" />
                            Repositories
                          </Label>
                          <Popover open={repoPopoverOpen} onOpenChange={setRepoPopoverOpen}>
                            <PopoverTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                                <Plus className="h-3 w-3" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64 p-0" align="end">
                              <Command>
                                <CommandInput placeholder="Search repositories..." />
                                <CommandList>
                                  {repos.filter((r) => !selectedRepos.includes(r.id)).length === 0 ? (
                                    <CommandEmpty>No more repositories</CommandEmpty>
                                  ) : (
                                    <CommandGroup>
                                      {repos.filter((r) => !selectedRepos.includes(r.id)).map((repo) => (
                                        <CommandItem
                                          key={repo.id}
                                          onSelect={() => {
                                            setSelectedRepos([...selectedRepos, repo.id])
                                            setRepoPopoverOpen(false)
                                          }}
                                        >
                                          <GitBranch className="h-4 w-4 mr-2 text-green-600" />
                                          <span>{repo.owner}/{repo.name}</span>
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
                                  )}
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        </div>
                        {selectedRepos.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {selectedRepos.map((repoId) => {
                              const repo = repos.find((r) => r.id === repoId)
                              return (
                                <Badge key={repoId} variant="secondary" className="text-xs gap-1">
                                  {repo?.name || 'Repo'}
                                  <X
                                    className="h-3 w-3 cursor-pointer hover:text-destructive"
                                    onClick={() => setSelectedRepos(selectedRepos.filter((id) => id !== repoId))}
                                  />
                                </Badge>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {/* Services */}
                      {availableContext.services.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs flex items-center gap-1.5">
                              <Server className="h-3.5 w-3.5 text-purple-600" />
                              Services
                            </Label>
                            <Popover open={servicePopoverOpen} onOpenChange={setServicePopoverOpen}>
                              <PopoverTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                                  <Plus className="h-3 w-3" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-64 p-0" align="end">
                                <Command>
                                  <CommandInput placeholder="Search services..." />
                                  <CommandList>
                                    {availableContext.services.filter((s) => !selectedServices.includes(s.id)).length === 0 ? (
                                      <CommandEmpty>No more services</CommandEmpty>
                                    ) : (
                                      <CommandGroup>
                                        {availableContext.services.filter((s) => !selectedServices.includes(s.id)).map((service) => (
                                          <CommandItem
                                            key={service.id}
                                            onSelect={() => {
                                              setSelectedServices([...selectedServices, service.id])
                                              setServicePopoverOpen(false)
                                            }}
                                          >
                                            <Server className="h-4 w-4 mr-2 text-purple-600" />
                                            <span>{service.display_name}</span>
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    )}
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                          </div>
                          {selectedServices.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {selectedServices.map((serviceId) => {
                                const service = availableContext.services.find((s) => s.id === serviceId)
                                return (
                                  <Badge key={serviceId} variant="secondary" className="text-xs gap-1">
                                    {service?.display_name || 'Service'}
                                    <X
                                      className="h-3 w-3 cursor-pointer hover:text-destructive"
                                      onClick={() => setSelectedServices(selectedServices.filter((id) => id !== serviceId))}
                                    />
                                  </Badge>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Assets */}
                      {availableContext.assets.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs flex items-center gap-1.5">
                              <Table2 className="h-3.5 w-3.5 text-blue-600" />
                              Assets
                            </Label>
                            <Popover open={assetPopoverOpen} onOpenChange={setAssetPopoverOpen}>
                              <PopoverTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                                  <Plus className="h-3 w-3" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-72 p-0" align="end">
                                <Command>
                                  <CommandInput placeholder="Search assets..." />
                                  <CommandList>
                                    {availableContext.assets.filter((a) => !selectedAssets.includes(a.id)).length === 0 ? (
                                      <CommandEmpty>No more assets</CommandEmpty>
                                    ) : (
                                      <CommandGroup>
                                        {availableContext.assets.filter((a) => !selectedAssets.includes(a.id)).map((asset) => (
                                          <CommandItem
                                            key={asset.id}
                                            onSelect={() => {
                                              setSelectedAssets([...selectedAssets, asset.id])
                                              setAssetPopoverOpen(false)
                                            }}
                                          >
                                            <Table2 className="h-4 w-4 mr-2 text-blue-600" />
                                            <span>{asset.name}</span>
                                            <span className="ml-auto text-xs text-muted-foreground">{asset.asset_type}</span>
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    )}
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                          </div>
                          {selectedAssets.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {selectedAssets.map((assetId) => {
                                const asset = availableContext.assets.find((a) => a.id === assetId)
                                return (
                                  <Badge key={assetId} variant="secondary" className="text-xs gap-1">
                                    {asset?.name || 'Asset'}
                                    <X
                                      className="h-3 w-3 cursor-pointer hover:text-destructive"
                                      onClick={() => setSelectedAssets(selectedAssets.filter((id) => id !== assetId))}
                                    />
                                  </Badge>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Documentation */}
                      {availableContext.docs.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs flex items-center gap-1.5">
                              <FileText className="h-3.5 w-3.5 text-orange-600" />
                              Documentation
                            </Label>
                            <Popover open={docPopoverOpen} onOpenChange={setDocPopoverOpen}>
                              <PopoverTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                                  <Plus className="h-3 w-3" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-72 p-0" align="end">
                                <Command>
                                  <CommandInput placeholder="Search docs..." />
                                  <CommandList>
                                    {availableContext.docs.filter((d) => !selectedDocs.includes(d.id)).length === 0 ? (
                                      <CommandEmpty>No more docs</CommandEmpty>
                                    ) : (
                                      <CommandGroup>
                                        {availableContext.docs.filter((d) => !selectedDocs.includes(d.id)).map((doc) => (
                                          <CommandItem
                                            key={doc.id}
                                            onSelect={() => {
                                              setSelectedDocs([...selectedDocs, doc.id])
                                              setDocPopoverOpen(false)
                                            }}
                                          >
                                            <FileText className="h-4 w-4 mr-2 text-orange-600" />
                                            <span className="truncate">{doc.title}</span>
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    )}
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                          </div>
                          {selectedDocs.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {selectedDocs.map((docId) => {
                                const doc = availableContext.docs.find((d) => d.id === docId)
                                return (
                                  <Badge key={docId} variant="secondary" className="text-xs gap-1">
                                    {doc?.title || 'Doc'}
                                    <X
                                      className="h-3 w-3 cursor-pointer hover:text-destructive"
                                      onClick={() => setSelectedDocs(selectedDocs.filter((id) => id !== docId))}
                                    />
                                  </Badge>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Features */}
                      {availableContext.features.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs flex items-center gap-1.5">
                              <Workflow className="h-3.5 w-3.5 text-cyan-600" />
                              Features
                            </Label>
                            <Popover open={featurePopoverOpen} onOpenChange={setFeaturePopoverOpen}>
                              <PopoverTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                                  <Plus className="h-3 w-3" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-72 p-0" align="end">
                                <Command>
                                  <CommandInput placeholder="Search features..." />
                                  <CommandList>
                                    {availableContext.features.filter((f) => !selectedFeatures.includes(f.id)).length === 0 ? (
                                      <CommandEmpty>No more features</CommandEmpty>
                                    ) : (
                                      <CommandGroup>
                                        {availableContext.features.filter((f) => !selectedFeatures.includes(f.id)).map((feature) => (
                                          <CommandItem
                                            key={feature.id}
                                            onSelect={() => {
                                              setSelectedFeatures([...selectedFeatures, feature.id])
                                              setFeaturePopoverOpen(false)
                                            }}
                                          >
                                            <Workflow className="h-4 w-4 mr-2 text-cyan-600" />
                                            <span className="truncate">{feature.feature_name}</span>
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    )}
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                          </div>
                          {selectedFeatures.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {selectedFeatures.map((featureId) => {
                                const feature = availableContext.features.find((f) => f.id === featureId)
                                return (
                                  <Badge key={featureId} variant="secondary" className="text-xs gap-1">
                                    {feature?.feature_name || 'Feature'}
                                    <X
                                      className="h-3 w-3 cursor-pointer hover:text-destructive"
                                      onClick={() => setSelectedFeatures(selectedFeatures.filter((id) => id !== featureId))}
                                    />
                                  </Badge>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Related Tickets */}
                      {availableContext.tickets.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs flex items-center gap-1.5">
                              <Ticket className="h-3.5 w-3.5 text-pink-600" />
                              Related Tickets
                            </Label>
                            <Popover open={ticketPopoverOpen} onOpenChange={setTicketPopoverOpen}>
                              <PopoverTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                                  <Plus className="h-3 w-3" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-80 p-0" align="end">
                                <div className="p-2 border-b">
                                  <Select
                                    value={ticketLinkType}
                                    onValueChange={(v) => setTicketLinkType(v as TicketLinkType)}
                                  >
                                    <SelectTrigger className="h-8">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {TICKET_LINK_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                          {opt.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <Command>
                                  <CommandInput placeholder="Search tickets..." />
                                  <CommandList>
                                    {availableContext.tickets.filter((t) => !selectedTickets.some((st) => st.id === t.id)).length === 0 ? (
                                      <CommandEmpty>No more tickets</CommandEmpty>
                                    ) : (
                                      <CommandGroup>
                                        {availableContext.tickets.filter((t) => !selectedTickets.some((st) => st.id === t.id)).map((ticket) => (
                                          <CommandItem
                                            key={ticket.id}
                                            onSelect={() => {
                                              setSelectedTickets([...selectedTickets, { id: ticket.id, linkType: ticketLinkType }])
                                              setTicketPopoverOpen(false)
                                            }}
                                          >
                                            <Ticket className="h-4 w-4 mr-2 text-pink-600" />
                                            <span className="font-mono text-xs mr-2">{ticket.key}</span>
                                            <span className="truncate">{ticket.title}</span>
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    )}
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                          </div>
                          {selectedTickets.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {selectedTickets.map((selection) => {
                                const ticket = availableContext.tickets.find((t) => t.id === selection.id)
                                return (
                                  <Badge key={selection.id} variant="secondary" className="text-xs gap-1">
                                    {TICKET_LINK_LABELS[selection.linkType]?.icon}
                                    <span className="font-mono">{ticket?.key || 'Ticket'}</span>
                                    <X
                                      className="h-3 w-3 cursor-pointer hover:text-destructive"
                                      onClick={() => setSelectedTickets(selectedTickets.filter((s) => s.id !== selection.id))}
                                    />
                                  </Badge>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !title.trim()}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
