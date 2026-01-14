'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { cn } from '@/lib/utils'
import {
  X,
  Plus,
  Database,
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
  BookOpen,
} from 'lucide-react'
import type {
  TaskLinkedContext,
  TaskServiceLink,
  TaskAssetLink,
  TaskRepoLink,
  TaskDocLink,
  TaskFeatureLink,
  TaskTicketLink,
  ContextSuggestionType,
  TicketLinkType,
  TaskStatus,
  TaskType,
} from '@laneshare/shared'

interface AvailableContext {
  services: Array<{ id: string; service: string; display_name: string }>
  assets: Array<{ id: string; name: string; asset_type: string; service: string }>
  repos: Array<{ id: string; owner: string; name: string }>
  docs: Array<{ id: string; slug: string; title: string; category?: string }>
  features: Array<{ id: string; feature_slug: string; feature_name: string; description?: string }>
  tickets: Array<{ id: string; key: string; title: string; status: TaskStatus; type: TaskType }>
}

interface LinkedContextDisplayProps {
  projectId: string
  taskId: string
  linkedContext: TaskLinkedContext
  availableContext: AvailableContext
  onContextChange: () => void
  className?: string
}

const TYPE_ICONS: Record<ContextSuggestionType, React.ReactNode> = {
  service: <Server className="h-3 w-3" />,
  asset: <Table2 className="h-3 w-3" />,
  repo: <GitBranch className="h-3 w-3" />,
  doc: <FileText className="h-3 w-3" />,
  feature: <Workflow className="h-3 w-3" />,
  ticket: <Ticket className="h-3 w-3" />,
  repo_doc: <BookOpen className="h-3 w-3" />,
}

const TYPE_COLORS: Record<ContextSuggestionType, string> = {
  service: 'bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-200',
  asset: 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200',
  repo: 'bg-green-100 text-green-800 border-green-200 hover:bg-green-200',
  doc: 'bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-200',
  feature: 'bg-cyan-100 text-cyan-800 border-cyan-200 hover:bg-cyan-200',
  ticket: 'bg-pink-100 text-pink-800 border-pink-200 hover:bg-pink-200',
  repo_doc: 'bg-teal-100 text-teal-800 border-teal-200 hover:bg-teal-200',
}

const TICKET_LINK_LABELS: Record<TicketLinkType, { label: string; icon: React.ReactNode }> = {
  related: { label: 'Related', icon: <Link2 className="h-3 w-3" /> },
  blocks: { label: 'Blocks', icon: <ArrowRight className="h-3 w-3" /> },
  blocked_by: { label: 'Blocked by', icon: <ArrowLeft className="h-3 w-3" /> },
  duplicates: { label: 'Duplicates', icon: <Copy className="h-3 w-3" /> },
  duplicated_by: { label: 'Duplicated by', icon: <Copy className="h-3 w-3" /> },
}

export function LinkedContextDisplay({
  projectId,
  taskId,
  linkedContext,
  availableContext,
  onContextChange,
  className,
}: LinkedContextDisplayProps) {
  const { toast } = useToast()
  const [isAdding, setIsAdding] = useState(false)
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())
  const [addingId, setAddingId] = useState<string | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [ticketLinkType, setTicketLinkType] = useState<TicketLinkType>('related')

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

  const handleAddLink = async (type: ContextSuggestionType, id: string, linkType?: TicketLinkType) => {
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
      setPopoverOpen(false)
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

  const availableServices = availableContext.services.filter(
    (s) => !linkedServiceIds.has(s.id)
  )
  const availableAssets = availableContext.assets.filter(
    (a) => !linkedAssetIds.has(a.id)
  )
  const availableRepos = availableContext.repos.filter(
    (r) => !linkedRepoIds.has(r.id)
  )
  const availableDocs = availableContext.docs.filter(
    (d) => !linkedDocIds.has(d.id)
  )
  const availableFeatures = availableContext.features.filter(
    (f) => !linkedFeatureIds.has(f.id)
  )
  // Filter out the current task from available tickets
  const availableTickets = availableContext.tickets.filter(
    (t) => !linkedTicketIds.has(t.id) && t.id !== taskId
  )

  const hasAvailableItems =
    availableServices.length > 0 ||
    availableAssets.length > 0 ||
    availableRepos.length > 0 ||
    availableDocs.length > 0 ||
    availableFeatures.length > 0 ||
    availableTickets.length > 0

  const hasLinkedItems =
    linkedContext.services.length > 0 ||
    linkedContext.assets.length > 0 ||
    linkedContext.repos.length > 0 ||
    linkedContext.docs.length > 0 ||
    linkedContext.features.length > 0 ||
    linkedContext.tickets.length > 0

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-muted-foreground">Linked Context</h4>
        {hasAvailableItems && (
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                <Plus className="h-3 w-3 mr-1" />
                Link
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              <Command>
                <CommandInput placeholder="Search context..." />
                <CommandList>
                  <CommandEmpty>No items found.</CommandEmpty>

                  {availableServices.length > 0 && (
                    <CommandGroup heading="Services">
                      {availableServices.map((service) => (
                        <CommandItem
                          key={service.id}
                          onSelect={() => handleAddLink('service', service.id)}
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

                  {availableAssets.length > 0 && (
                    <CommandGroup heading="Assets">
                      {availableAssets.map((asset) => (
                        <CommandItem
                          key={asset.id}
                          onSelect={() => handleAddLink('asset', asset.id)}
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

                  {availableRepos.length > 0 && (
                    <CommandGroup heading="Repositories">
                      {availableRepos.map((repo) => (
                        <CommandItem
                          key={repo.id}
                          onSelect={() => handleAddLink('repo', repo.id)}
                          disabled={addingId === repo.id}
                        >
                          <GitBranch className="h-4 w-4 mr-2 text-green-600" />
                          <span>{repo.owner}/{repo.name}</span>
                          {addingId === repo.id && (
                            <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}

                  {availableDocs.length > 0 && (
                    <CommandGroup heading="Documentation">
                      {availableDocs.map((doc) => (
                        <CommandItem
                          key={doc.id}
                          onSelect={() => handleAddLink('doc', doc.id)}
                          disabled={addingId === doc.id}
                        >
                          <FileText className="h-4 w-4 mr-2 text-orange-600" />
                          <span>{doc.title}</span>
                          {doc.category && (
                            <span className="ml-auto text-xs text-muted-foreground">
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

                  {availableFeatures.length > 0 && (
                    <CommandGroup heading="Architecture Features">
                      {availableFeatures.map((feature) => (
                        <CommandItem
                          key={feature.id}
                          onSelect={() => handleAddLink('feature', feature.id)}
                          disabled={addingId === feature.id}
                        >
                          <Workflow className="h-4 w-4 mr-2 text-cyan-600" />
                          <span>{feature.feature_name}</span>
                          {addingId === feature.id && (
                            <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}

                  {availableTickets.length > 0 && (
                    <CommandGroup heading="Related Tickets">
                      {availableTickets.map((ticket) => (
                        <CommandItem
                          key={ticket.id}
                          onSelect={() => handleAddLink('ticket', ticket.id, ticketLinkType)}
                          disabled={addingId === ticket.id}
                        >
                          <Ticket className="h-4 w-4 mr-2 text-pink-600" />
                          <span className="font-mono text-xs mr-1">{ticket.key}</span>
                          <span className="truncate">{ticket.title}</span>
                          <span className="ml-auto text-xs text-muted-foreground">
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
        )}
      </div>

      {hasLinkedItems ? (
        <div className="flex flex-wrap gap-1.5">
          {/* Services */}
          {linkedContext.services.map((link) => (
            <Badge
              key={link.id}
              variant="outline"
              className={cn(
                'gap-1 pr-1',
                TYPE_COLORS.service,
                removingIds.has(link.id) && 'opacity-50'
              )}
            >
              {TYPE_ICONS.service}
              <span>{link.connection?.display_name || 'Service'}</span>
              <button
                onClick={() => handleRemoveLink('service', link.id)}
                disabled={removingIds.has(link.id)}
                className="ml-1 rounded-full p-0.5 hover:bg-purple-300"
              >
                {removingIds.has(link.id) ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <X className="h-3 w-3" />
                )}
              </button>
            </Badge>
          ))}

          {/* Assets */}
          {linkedContext.assets.map((link) => (
            <Badge
              key={link.id}
              variant="outline"
              className={cn(
                'gap-1 pr-1',
                TYPE_COLORS.asset,
                removingIds.has(link.id) && 'opacity-50'
              )}
            >
              {TYPE_ICONS.asset}
              <span>{link.asset?.name || 'Asset'}</span>
              <span className="text-[10px] opacity-70">
                ({link.asset?.asset_type})
              </span>
              <button
                onClick={() => handleRemoveLink('asset', link.id)}
                disabled={removingIds.has(link.id)}
                className="ml-1 rounded-full p-0.5 hover:bg-blue-300"
              >
                {removingIds.has(link.id) ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <X className="h-3 w-3" />
                )}
              </button>
            </Badge>
          ))}

          {/* Repos */}
          {linkedContext.repos.map((link) => (
            <Badge
              key={link.id}
              variant="outline"
              className={cn(
                'gap-1 pr-1',
                TYPE_COLORS.repo,
                removingIds.has(link.id) && 'opacity-50'
              )}
            >
              {TYPE_ICONS.repo}
              <span>
                {link.repo ? `${link.repo.owner}/${link.repo.name}` : 'Repository'}
              </span>
              <button
                onClick={() => handleRemoveLink('repo', link.id)}
                disabled={removingIds.has(link.id)}
                className="ml-1 rounded-full p-0.5 hover:bg-green-300"
              >
                {removingIds.has(link.id) ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <X className="h-3 w-3" />
                )}
              </button>
            </Badge>
          ))}

          {/* Docs */}
          {linkedContext.docs.map((link) => (
            <Badge
              key={link.id}
              variant="outline"
              className={cn(
                'gap-1 pr-1',
                TYPE_COLORS.doc,
                removingIds.has(link.id) && 'opacity-50'
              )}
            >
              {TYPE_ICONS.doc}
              <span>{link.doc?.title || 'Document'}</span>
              <button
                onClick={() => handleRemoveLink('doc', link.id)}
                disabled={removingIds.has(link.id)}
                className="ml-1 rounded-full p-0.5 hover:bg-orange-300"
              >
                {removingIds.has(link.id) ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <X className="h-3 w-3" />
                )}
              </button>
            </Badge>
          ))}

          {/* Features */}
          {linkedContext.features.map((link) => (
            <Badge
              key={link.id}
              variant="outline"
              className={cn(
                'gap-1 pr-1',
                TYPE_COLORS.feature,
                removingIds.has(link.id) && 'opacity-50'
              )}
            >
              {TYPE_ICONS.feature}
              <span>{link.feature?.feature_name || 'Feature'}</span>
              <button
                onClick={() => handleRemoveLink('feature', link.id)}
                disabled={removingIds.has(link.id)}
                className="ml-1 rounded-full p-0.5 hover:bg-cyan-300"
              >
                {removingIds.has(link.id) ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <X className="h-3 w-3" />
                )}
              </button>
            </Badge>
          ))}

          {/* Tickets */}
          {linkedContext.tickets.map((link) => (
            <Badge
              key={link.id}
              variant="outline"
              className={cn(
                'gap-1 pr-1',
                TYPE_COLORS.ticket,
                removingIds.has(link.id) && 'opacity-50'
              )}
            >
              {TICKET_LINK_LABELS[link.link_type]?.icon || TYPE_ICONS.ticket}
              <span className="text-[10px] opacity-70">
                {TICKET_LINK_LABELS[link.link_type]?.label || 'Related'}:
              </span>
              <span className="font-mono text-xs">
                {link.linked_task?.key || 'Ticket'}
              </span>
              <button
                onClick={() => handleRemoveLink('ticket', link.id)}
                disabled={removingIds.has(link.id)}
                className="ml-1 rounded-full p-0.5 hover:bg-pink-300"
              >
                {removingIds.has(link.id) ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <X className="h-3 w-3" />
                )}
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">
          No context linked. Link services, repos, docs, features, or tickets to include them in prompts.
        </p>
      )}
    </div>
  )
}
