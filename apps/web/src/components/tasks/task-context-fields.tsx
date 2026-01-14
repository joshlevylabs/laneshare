'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  X,
  Plus,
  GitBranch,
  FileText,
  Server,
  Table2,
  Loader2,
  Workflow,
  Ticket,
  Link2,
  ArrowRight,
  ArrowLeft,
  Copy,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Bug,
  Zap,
  BookOpen,
  FlaskConical,
  CheckSquare,
  LayoutList,
  Sparkles,
} from 'lucide-react'
import { ContextSuggestionsPanel } from './context-suggestions-panel'
import type {
  TaskLinkedContext,
  ContextSuggestionType,
  TicketLinkType,
  TaskStatus,
  TaskType,
  TaskSummary,
} from '@laneshare/shared'

const TYPE_ICONS: Record<TaskType, React.ElementType> = {
  EPIC: Zap,
  STORY: BookOpen,
  FEATURE: LayoutList,
  TASK: CheckSquare,
  BUG: Bug,
  SPIKE: FlaskConical,
  SUBTASK: GitBranch,
}

const TYPE_COLORS: Record<TaskType, string> = {
  EPIC: 'text-purple-500',
  STORY: 'text-blue-500',
  FEATURE: 'text-cyan-500',
  TASK: 'text-green-500',
  BUG: 'text-red-500',
  SPIKE: 'text-yellow-500',
  SUBTASK: 'text-gray-500',
}

interface AvailableContext {
  services: Array<{ id: string; service: string; display_name: string }>
  assets: Array<{ id: string; name: string; asset_type: string; service: string }>
  repos: Array<{ id: string; owner: string; name: string }>
  docs: Array<{ id: string; slug: string; title: string; category?: string }>
  features: Array<{ id: string; feature_slug: string; feature_name: string; description?: string }>
  tickets: Array<{ id: string; key: string; title: string; status: TaskStatus; type: TaskType }>
}

interface TaskContextFieldsProps {
  projectId: string
  taskId: string
  linkedContext: TaskLinkedContext
  availableContext: AvailableContext
  onContextChange: () => void
  parentTask?: TaskSummary | null
  childTasks?: TaskSummary[]
  className?: string
}

const TICKET_LINK_LABELS: Record<TicketLinkType, { label: string; icon: React.ReactNode }> = {
  related: { label: 'Related', icon: <Link2 className="h-3 w-3" /> },
  blocks: { label: 'Blocks', icon: <ArrowRight className="h-3 w-3" /> },
  blocked_by: { label: 'Blocked by', icon: <ArrowLeft className="h-3 w-3" /> },
  duplicates: { label: 'Duplicates', icon: <Copy className="h-3 w-3" /> },
  duplicated_by: { label: 'Duplicated by', icon: <Copy className="h-3 w-3" /> },
}

const TICKET_LINK_OPTIONS: { value: TicketLinkType; label: string }[] = [
  { value: 'related', label: 'Related to' },
  { value: 'blocks', label: 'Blocks' },
  { value: 'blocked_by', label: 'Blocked by' },
  { value: 'duplicates', label: 'Duplicates' },
  { value: 'duplicated_by', label: 'Duplicated by' },
]

export function TaskContextFields({
  projectId,
  taskId,
  linkedContext,
  availableContext,
  onContextChange,
  parentTask,
  childTasks = [],
  className,
}: TaskContextFieldsProps) {
  const { toast } = useToast()
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())
  const [addingId, setAddingId] = useState<string | null>(null)
  const [ticketLinkType, setTicketLinkType] = useState<TicketLinkType>('related')

  // Section open states
  const [hierarchyOpen, setHierarchyOpen] = useState(true)
  const [reposOpen, setReposOpen] = useState(true)
  const [servicesOpen, setServicesOpen] = useState(true)
  const [docsOpen, setDocsOpen] = useState(true)
  const [featuresOpen, setFeaturesOpen] = useState(true)
  const [ticketsOpen, setTicketsOpen] = useState(true)
  const [showSuggestions, setShowSuggestions] = useState(false)

  // Popover states
  const [repoPopoverOpen, setRepoPopoverOpen] = useState(false)
  const [servicePopoverOpen, setServicePopoverOpen] = useState(false)
  const [assetPopoverOpen, setAssetPopoverOpen] = useState(false)
  const [docPopoverOpen, setDocPopoverOpen] = useState(false)
  const [featurePopoverOpen, setFeaturePopoverOpen] = useState(false)
  const [ticketPopoverOpen, setTicketPopoverOpen] = useState(false)

  const handleRemoveLink = async (type: ContextSuggestionType, linkId: string) => {
    setRemovingIds((prev) => new Set(Array.from(prev).concat(linkId)))

    try {
      const response = await fetch(
        `/api/projects/${projectId}/tasks/${taskId}/context`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, linkId }),
        }
      )

      if (!response.ok) {
        throw new Error('Failed to remove link')
      }

      onContextChange()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to remove context link',
      })
    } finally {
      setRemovingIds((prev) => {
        const next = new Set(prev)
        next.delete(linkId)
        return next
      })
    }
  }

  const handleAddLink = async (
    type: ContextSuggestionType,
    id: string,
    closePopover: () => void,
    linkType?: TicketLinkType
  ) => {
    setAddingId(id)

    try {
      const body: { type: string; id: string; linkType?: TicketLinkType } = { type, id }
      if (type === 'ticket' && linkType) {
        body.linkType = linkType
      }

      const response = await fetch(
        `/api/projects/${projectId}/tasks/${taskId}/context`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to add link')
      }

      onContextChange()
      closePopover()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add context link',
      })
    } finally {
      setAddingId(null)
    }
  }

  // Filter out already linked items
  const linkedServiceIds = new Set(linkedContext.services.map((s) => s.connection_id))
  const linkedAssetIds = new Set(linkedContext.assets.map((a) => a.asset_id))
  const linkedRepoIds = new Set(linkedContext.repos.map((r) => r.repo_id))
  const linkedDocIds = new Set(linkedContext.docs.map((d) => d.doc_id))
  const linkedFeatureIds = new Set(linkedContext.features.map((f) => f.feature_id))
  const linkedTicketIds = new Set(linkedContext.tickets.map((t) => t.linked_task_id))

  const availableRepos = availableContext.repos.filter(
    (r) => !linkedRepoIds.has(r.id)
  )
  const availableServices = availableContext.services.filter(
    (s) => !linkedServiceIds.has(s.id)
  )
  const availableAssets = availableContext.assets.filter(
    (a) => !linkedAssetIds.has(a.id)
  )
  const availableDocs = availableContext.docs.filter(
    (d) => !linkedDocIds.has(d.id)
  )
  const availableFeatures = availableContext.features.filter(
    (f) => !linkedFeatureIds.has(f.id)
  )
  const availableTickets = availableContext.tickets.filter(
    (t) => !linkedTicketIds.has(t.id) && t.id !== taskId
  )

  const handleLinkContextFromSuggestion = async (type: ContextSuggestionType, id: string) => {
    const response = await fetch(
      `/api/projects/${projectId}/tasks/${taskId}/context`,
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

    onContextChange()
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Context</h4>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowSuggestions(!showSuggestions)}
          className="h-7 text-xs"
        >
          <Sparkles className="h-3 w-3 mr-1" />
          {showSuggestions ? 'Hide Suggestions' : 'Suggest Context'}
        </Button>
      </div>

      {showSuggestions && (
        <div className="border rounded-lg p-3 bg-muted/30">
          <ContextSuggestionsPanel
            projectId={projectId}
            taskId={taskId}
            onLinkContext={handleLinkContextFromSuggestion}
          />
        </div>
      )}

      {/* Hierarchy Section - Auto-populated from parent/children relationships */}
      {(parentTask || childTasks.length > 0) && (
        <Collapsible open={hierarchyOpen} onOpenChange={setHierarchyOpen}>
          <div className="border rounded-md border-indigo-200 dark:border-indigo-800">
            <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 hover:bg-muted/50 rounded-t-md">
              {hierarchyOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <GitBranch className="h-4 w-4 text-indigo-600" />
              <Label className="text-xs font-medium cursor-pointer">Task Hierarchy</Label>
              <Badge variant="secondary" className="h-5 px-1.5 text-xs ml-auto">
                Auto
              </Badge>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="p-2 pt-0 space-y-2">
                {/* Parent Task */}
                {parentTask && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ArrowUp className="h-3 w-3" />
                      Parent
                    </div>
                    <div className="flex items-center gap-2 p-1.5 rounded bg-indigo-50 dark:bg-indigo-950/30">
                      {(() => {
                        const ParentTypeIcon = TYPE_ICONS[parentTask.type]
                        return (
                          <ParentTypeIcon
                            className={cn('h-3.5 w-3.5 shrink-0', TYPE_COLORS[parentTask.type])}
                          />
                        )
                      })()}
                      <span className="font-mono text-xs text-muted-foreground shrink-0">
                        {parentTask.key}
                      </span>
                      <span className="text-xs truncate flex-1">{parentTask.title}</span>
                      <Badge variant="outline" className="h-4 px-1 text-[10px] shrink-0">
                        {parentTask.status.replace('_', ' ')}
                      </Badge>
                    </div>
                  </div>
                )}

                {/* Child Tasks */}
                {childTasks.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ArrowDown className="h-3 w-3" />
                      Children ({childTasks.length})
                    </div>
                    <div className="space-y-1 max-h-[120px] overflow-y-auto">
                      {childTasks.map((child) => {
                        const ChildTypeIcon = TYPE_ICONS[child.type]
                        return (
                          <div
                            key={child.id}
                            className="flex items-center gap-2 p-1.5 rounded bg-indigo-50 dark:bg-indigo-950/30"
                          >
                            <ChildTypeIcon
                              className={cn('h-3.5 w-3.5 shrink-0', TYPE_COLORS[child.type])}
                            />
                            <span className="font-mono text-xs text-muted-foreground shrink-0">
                              {child.key}
                            </span>
                            <span className="text-xs truncate flex-1">{child.title}</span>
                            <Badge variant="outline" className="h-4 px-1 text-[10px] shrink-0">
                              {child.status.replace('_', ' ')}
                            </Badge>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                <p className="text-[10px] text-muted-foreground italic pt-1">
                  Hierarchy relationships are auto-linked based on parent/child structure
                </p>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}

      {/* Repositories Section */}
      <Collapsible open={reposOpen} onOpenChange={setReposOpen}>
        <div className="border rounded-md">
          <div className="flex items-center justify-between p-2">
            <CollapsibleTrigger className="flex items-center gap-2 hover:bg-muted/50 rounded px-1 -mx-1 flex-1">
              {reposOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <GitBranch className="h-4 w-4 text-green-600" />
              <Label className="text-xs font-medium cursor-pointer">Repositories</Label>
              {linkedContext.repos.length > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                  {linkedContext.repos.length}
                </Badge>
              )}
            </CollapsibleTrigger>
            <Popover open={repoPopoverOpen} onOpenChange={setRepoPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="end">
                <Command>
                  <CommandInput placeholder="Search repositories..." />
                  <CommandList>
                    {availableRepos.length === 0 ? (
                      <CommandEmpty>No repositories available. Connect a repository to your project first.</CommandEmpty>
                    ) : (
                      <CommandGroup>
                        {availableRepos.map((repo) => (
                          <CommandItem
                            key={repo.id}
                            onSelect={() =>
                              handleAddLink('repo', repo.id, () => setRepoPopoverOpen(false))
                            }
                            disabled={addingId === repo.id}
                          >
                            <GitBranch className="h-4 w-4 mr-2 text-green-600" />
                            <span>{repo.owner}/{repo.name}</span>
                            {addingId === repo.id && (
                              <Loader2 className="h-4 w-4 ml-auto animate-spin" />
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <CollapsibleContent>
            <div className="p-2 pt-0 space-y-1">
              {linkedContext.repos.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-1">No repositories linked</p>
              ) : (
                linkedContext.repos.map((link) => (
                  <div
                    key={link.id}
                    className={cn(
                      'flex items-center justify-between gap-2 p-1.5 rounded bg-green-50 dark:bg-green-950/30',
                      removingIds.has(link.id) && 'opacity-50'
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <GitBranch className="h-3.5 w-3.5 text-green-600 shrink-0" />
                      <span className="text-xs truncate">
                        {link.repo ? `${link.repo.owner}/${link.repo.name}` : 'Repository'}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 shrink-0"
                      onClick={() => handleRemoveLink('repo', link.id)}
                      disabled={removingIds.has(link.id)}
                    >
                      {removingIds.has(link.id) ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Services & Assets Section */}
      <Collapsible open={servicesOpen} onOpenChange={setServicesOpen}>
        <div className="border rounded-md">
          <div className="flex items-center justify-between p-2">
            <CollapsibleTrigger className="flex items-center gap-2 hover:bg-muted/50 rounded px-1 -mx-1 flex-1">
              {servicesOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <Server className="h-4 w-4 text-purple-600" />
              <Label className="text-xs font-medium cursor-pointer">Services & Assets</Label>
              {(linkedContext.services.length + linkedContext.assets.length) > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                  {linkedContext.services.length + linkedContext.assets.length}
                </Badge>
              )}
            </CollapsibleTrigger>
            <div className="flex gap-1">
              <Popover open={servicePopoverOpen} onOpenChange={setServicePopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                  >
                    <Server className="h-3 w-3 mr-1" />
                    Service
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-0" align="end">
                  <Command>
                    <CommandInput placeholder="Search services..." />
                    <CommandList>
                      {availableServices.length === 0 ? (
                        <CommandEmpty>No services available. Connect a service to your project first.</CommandEmpty>
                      ) : (
                        <CommandGroup>
                          {availableServices.map((service) => (
                            <CommandItem
                              key={service.id}
                              onSelect={() =>
                                handleAddLink('service', service.id, () => setServicePopoverOpen(false))
                              }
                              disabled={addingId === service.id}
                            >
                              <Server className="h-4 w-4 mr-2 text-purple-600" />
                              <span>{service.display_name}</span>
                              <span className="ml-auto text-xs text-muted-foreground">
                                {service.service}
                              </span>
                              {addingId === service.id && (
                                <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                              )}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <Popover open={assetPopoverOpen} onOpenChange={setAssetPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                  >
                    <Table2 className="h-3 w-3 mr-1" />
                    Asset
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0" align="end">
                  <Command>
                    <CommandInput placeholder="Search assets..." />
                    <CommandList>
                      {availableAssets.length === 0 ? (
                        <CommandEmpty>No assets available. Connect a service and sync its assets first.</CommandEmpty>
                      ) : (
                        <CommandGroup>
                          {availableAssets.map((asset) => (
                            <CommandItem
                              key={asset.id}
                              onSelect={() =>
                                handleAddLink('asset', asset.id, () => setAssetPopoverOpen(false))
                              }
                              disabled={addingId === asset.id}
                            >
                              <Table2 className="h-4 w-4 mr-2 text-blue-600" />
                              <span>{asset.name}</span>
                              <span className="ml-auto text-xs text-muted-foreground">
                                {asset.asset_type}
                              </span>
                              {addingId === asset.id && (
                                <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                              )}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <CollapsibleContent>
            <div className="p-2 pt-0 space-y-1">
              {linkedContext.services.length === 0 && linkedContext.assets.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-1">No services or assets linked</p>
              ) : (
                <>
                  {linkedContext.services.map((link) => (
                    <div
                      key={link.id}
                      className={cn(
                        'flex items-center justify-between gap-2 p-1.5 rounded bg-purple-50 dark:bg-purple-950/30',
                        removingIds.has(link.id) && 'opacity-50'
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Server className="h-3.5 w-3.5 text-purple-600 shrink-0" />
                        <span className="text-xs truncate">
                          {link.connection?.display_name || 'Service'}
                        </span>
                        <Badge variant="outline" className="h-4 px-1 text-[10px]">
                          {link.connection?.service}
                        </Badge>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 shrink-0"
                        onClick={() => handleRemoveLink('service', link.id)}
                        disabled={removingIds.has(link.id)}
                      >
                        {removingIds.has(link.id) ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <X className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  ))}
                  {linkedContext.assets.map((link) => (
                    <div
                      key={link.id}
                      className={cn(
                        'flex items-center justify-between gap-2 p-1.5 rounded bg-blue-50 dark:bg-blue-950/30',
                        removingIds.has(link.id) && 'opacity-50'
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Table2 className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                        <span className="text-xs truncate">{link.asset?.name || 'Asset'}</span>
                        <Badge variant="outline" className="h-4 px-1 text-[10px]">
                          {link.asset?.asset_type}
                        </Badge>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 shrink-0"
                        onClick={() => handleRemoveLink('asset', link.id)}
                        disabled={removingIds.has(link.id)}
                      >
                        {removingIds.has(link.id) ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <X className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Documentation Section */}
      <Collapsible open={docsOpen} onOpenChange={setDocsOpen}>
        <div className="border rounded-md">
          <div className="flex items-center justify-between p-2">
            <CollapsibleTrigger className="flex items-center gap-2 hover:bg-muted/50 rounded px-1 -mx-1 flex-1">
              {docsOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <FileText className="h-4 w-4 text-orange-600" />
              <Label className="text-xs font-medium cursor-pointer">Documentation</Label>
              {linkedContext.docs.length > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                  {linkedContext.docs.length}
                </Badge>
              )}
            </CollapsibleTrigger>
            <Popover open={docPopoverOpen} onOpenChange={setDocPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0" align="end">
                <Command>
                  <CommandInput placeholder="Search documentation..." />
                  <CommandList>
                    {availableDocs.length === 0 ? (
                      <CommandEmpty>No documentation available. Create some docs first.</CommandEmpty>
                    ) : (
                      <CommandGroup>
                        {availableDocs.map((doc) => (
                          <CommandItem
                            key={doc.id}
                            onSelect={() =>
                              handleAddLink('doc', doc.id, () => setDocPopoverOpen(false))
                            }
                            disabled={addingId === doc.id}
                          >
                            <FileText className="h-4 w-4 mr-2 text-orange-600" />
                            <span className="truncate">{doc.title}</span>
                            {doc.category && (
                              <span className="ml-auto text-xs text-muted-foreground shrink-0">
                                {doc.category}
                              </span>
                            )}
                            {addingId === doc.id && (
                              <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <CollapsibleContent>
            <div className="p-2 pt-0 space-y-1">
              {linkedContext.docs.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-1">No documentation linked</p>
              ) : (
                linkedContext.docs.map((link) => (
                  <div
                    key={link.id}
                    className={cn(
                      'flex items-center justify-between gap-2 p-1.5 rounded bg-orange-50 dark:bg-orange-950/30',
                      removingIds.has(link.id) && 'opacity-50'
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-3.5 w-3.5 text-orange-600 shrink-0" />
                      <span className="text-xs truncate">{link.doc?.title || 'Document'}</span>
                      {link.doc?.category && (
                        <Badge variant="outline" className="h-4 px-1 text-[10px]">
                          {link.doc.category}
                        </Badge>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 shrink-0"
                      onClick={() => handleRemoveLink('doc', link.id)}
                      disabled={removingIds.has(link.id)}
                    >
                      {removingIds.has(link.id) ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Architecture Features Section */}
      <Collapsible open={featuresOpen} onOpenChange={setFeaturesOpen}>
        <div className="border rounded-md">
          <div className="flex items-center justify-between p-2">
            <CollapsibleTrigger className="flex items-center gap-2 hover:bg-muted/50 rounded px-1 -mx-1 flex-1">
              {featuresOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <Workflow className="h-4 w-4 text-cyan-600" />
              <Label className="text-xs font-medium cursor-pointer">Architecture Features</Label>
              {linkedContext.features.length > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                  {linkedContext.features.length}
                </Badge>
              )}
            </CollapsibleTrigger>
            <Popover open={featurePopoverOpen} onOpenChange={setFeaturePopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0" align="end">
                <Command>
                  <CommandInput placeholder="Search features..." />
                  <CommandList>
                    {availableFeatures.length === 0 ? (
                      <CommandEmpty>No features available. Generate an architecture map first.</CommandEmpty>
                    ) : (
                      <CommandGroup>
                        {availableFeatures.map((feature) => (
                          <CommandItem
                            key={feature.id}
                            onSelect={() =>
                              handleAddLink('feature', feature.id, () => setFeaturePopoverOpen(false))
                            }
                            disabled={addingId === feature.id}
                          >
                            <Workflow className="h-4 w-4 mr-2 text-cyan-600" />
                            <div className="flex flex-col min-w-0">
                              <span className="truncate">{feature.feature_name}</span>
                              {feature.description && (
                                <span className="text-xs text-muted-foreground truncate">
                                  {feature.description}
                                </span>
                              )}
                            </div>
                            {addingId === feature.id && (
                              <Loader2 className="h-4 w-4 ml-auto animate-spin" />
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <CollapsibleContent>
            <div className="p-2 pt-0 space-y-1">
              {linkedContext.features.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-1">No features linked</p>
              ) : (
                linkedContext.features.map((link) => (
                  <div
                    key={link.id}
                    className={cn(
                      'flex items-center justify-between gap-2 p-1.5 rounded bg-cyan-50 dark:bg-cyan-950/30',
                      removingIds.has(link.id) && 'opacity-50'
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Workflow className="h-3.5 w-3.5 text-cyan-600 shrink-0" />
                      <span className="text-xs truncate">
                        {link.feature?.feature_name || 'Feature'}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 shrink-0"
                      onClick={() => handleRemoveLink('feature', link.id)}
                      disabled={removingIds.has(link.id)}
                    >
                      {removingIds.has(link.id) ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Related Tickets Section */}
      <Collapsible open={ticketsOpen} onOpenChange={setTicketsOpen}>
        <div className="border rounded-md">
          <div className="flex items-center justify-between p-2">
            <CollapsibleTrigger className="flex items-center gap-2 hover:bg-muted/50 rounded px-1 -mx-1 flex-1">
              {ticketsOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <Ticket className="h-4 w-4 text-pink-600" />
              <Label className="text-xs font-medium cursor-pointer">Related Tickets</Label>
              {linkedContext.tickets.length > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                  {linkedContext.tickets.length}
                </Badge>
              )}
            </CollapsibleTrigger>
            <Popover open={ticketPopoverOpen} onOpenChange={setTicketPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                >
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
                    {availableTickets.length === 0 ? (
                      <CommandEmpty>No other tickets available to link.</CommandEmpty>
                    ) : (
                      <CommandGroup>
                        {availableTickets.map((ticket) => (
                          <CommandItem
                            key={ticket.id}
                            onSelect={() =>
                              handleAddLink('ticket', ticket.id, () => setTicketPopoverOpen(false), ticketLinkType)
                            }
                            disabled={addingId === ticket.id}
                          >
                            <Ticket className="h-4 w-4 mr-2 text-pink-600" />
                            <span className="font-mono text-xs mr-2">{ticket.key}</span>
                            <span className="truncate">{ticket.title}</span>
                            <span className="ml-auto text-xs text-muted-foreground shrink-0">
                              {ticket.status}
                            </span>
                            {addingId === ticket.id && (
                              <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <CollapsibleContent>
            <div className="p-2 pt-0 space-y-1">
              {linkedContext.tickets.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-1">No related tickets</p>
              ) : (
                linkedContext.tickets.map((link) => (
                  <div
                    key={link.id}
                    className={cn(
                      'flex items-center justify-between gap-2 p-1.5 rounded bg-pink-50 dark:bg-pink-950/30',
                      removingIds.has(link.id) && 'opacity-50'
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {TICKET_LINK_LABELS[link.link_type]?.icon || <Link2 className="h-3.5 w-3.5" />}
                      <Badge variant="outline" className="h-4 px-1 text-[10px] shrink-0">
                        {TICKET_LINK_LABELS[link.link_type]?.label || 'Related'}
                      </Badge>
                      <span className="font-mono text-xs shrink-0">
                        {link.linked_task?.key || 'Ticket'}
                      </span>
                      <span className="text-xs truncate text-muted-foreground">
                        {link.linked_task?.title}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 shrink-0"
                      onClick={() => handleRemoveLink('ticket', link.id)}
                      disabled={removingIds.has(link.id)}
                    >
                      {removingIds.has(link.id) ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  )
}
