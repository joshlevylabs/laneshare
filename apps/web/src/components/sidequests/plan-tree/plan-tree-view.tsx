'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  ChevronRight,
  ChevronDown,
  Target,
  BookOpen,
  CheckSquare,
  Square,
  Check,
  X,
  Edit2,
  Trash2,
  Plus,
  GripVertical,
  FlaskConical,
  FileText,
  GitBranch,
  Box,
  Layers,
  LayoutList,
  TreePine,
  Table2,
} from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useToast } from '@/components/ui/use-toast'
import type { SidequestTicket, SidequestTicketType, SidequestTicketStatus } from '@laneshare/shared'

interface TreeTicket extends SidequestTicket {
  children?: TreeTicket[]
}

interface PlanTreeViewProps {
  sidequestId: string
  projectId: string
  tickets: SidequestTicket[]
  onTicketUpdate?: (ticket: SidequestTicket) => void
  onTicketDelete?: (ticketId: string) => void
  onRefresh?: () => void
  readonly?: boolean
}

const TICKET_TYPE_CONFIG: Record<
  SidequestTicketType,
  { icon: React.ElementType; color: string; bgColor: string }
> = {
  EPIC: { icon: Target, color: 'text-purple-600', bgColor: 'bg-purple-100' },
  STORY: { icon: BookOpen, color: 'text-blue-600', bgColor: 'bg-blue-100' },
  TASK: { icon: CheckSquare, color: 'text-green-600', bgColor: 'bg-green-100' },
  SUBTASK: { icon: Square, color: 'text-gray-600', bgColor: 'bg-gray-100' },
  TEST: { icon: FlaskConical, color: 'text-orange-600', bgColor: 'bg-orange-100' },
}

const STATUS_CONFIG: Record<SidequestTicketStatus, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  PENDING: { label: 'Pending', variant: 'outline' },
  APPROVED: { label: 'Approved', variant: 'default' },
  IN_PROGRESS: { label: 'In Progress', variant: 'default' },
  REVIEW: { label: 'Review', variant: 'secondary' },
  COMPLETED: { label: 'Done', variant: 'secondary' },
  SKIPPED: { label: 'Skipped', variant: 'outline' },
}

// Build tree structure from flat list
function buildTree(tickets: SidequestTicket[]): TreeTicket[] {
  const map = new Map<string, TreeTicket>()
  const roots: TreeTicket[] = []

  // First pass: create map
  for (const ticket of tickets) {
    map.set(ticket.id, { ...ticket, children: [] })
  }

  // Second pass: build tree
  for (const ticket of tickets) {
    const node = map.get(ticket.id)!
    if (ticket.parent_ticket_id && map.has(ticket.parent_ticket_id)) {
      map.get(ticket.parent_ticket_id)!.children!.push(node)
    } else {
      roots.push(node)
    }
  }

  // Sort by sort_order at each level
  const sortNodes = (nodes: TreeTicket[]) => {
    nodes.sort((a, b) => a.sort_order - b.sort_order)
    for (const node of nodes) {
      if (node.children && node.children.length > 0) {
        sortNodes(node.children)
      }
    }
  }
  sortNodes(roots)

  return roots
}

type ViewMode = 'tree' | 'table' | 'sprint' | 'priority'

export function PlanTreeView({
  sidequestId,
  projectId,
  tickets,
  onTicketUpdate,
  onTicketDelete,
  onRefresh,
  readonly = false,
}: PlanTreeViewProps) {
  const { toast } = useToast()
  const [viewMode, setViewMode] = useState<ViewMode>('tree')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    // Start with all epics and stories expanded
    const expanded = new Set<string>()
    for (const ticket of tickets) {
      if (ticket.ticket_type === 'EPIC' || ticket.ticket_type === 'STORY') {
        expanded.add(ticket.id)
      }
    }
    return expanded
  })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const tree = buildTree(tickets)

  // Group tickets by sprint
  const sprintGroups = tickets.reduce((acc, ticket) => {
    const sprint = ticket.sprint_group || 0
    if (!acc[sprint]) acc[sprint] = []
    acc[sprint].push(ticket)
    return acc
  }, {} as Record<number, SidequestTicket[]>)

  // Group tickets by priority
  const priorityOrder = ['URGENT', 'HIGH', 'MEDIUM', 'LOW', null]
  const priorityGroups = tickets.reduce((acc, ticket) => {
    const priority = ticket.priority || 'Unset'
    if (!acc[priority]) acc[priority] = []
    acc[priority].push(ticket)
    return acc
  }, {} as Record<string, SidequestTicket[]>)

  // Confidence threshold for auto-approval
  const CONFIDENCE_THRESHOLD = 0.7

  // Count tickets by confidence
  const pendingTickets = tickets.filter((t) => t.status === 'PENDING')
  const highConfidenceTickets = pendingTickets.filter(
    (t) => (t.confidence_score ?? 1) >= CONFIDENCE_THRESHOLD
  )
  const lowConfidenceTickets = pendingTickets.filter(
    (t) => t.confidence_score !== null && t.confidence_score !== undefined && t.confidence_score < CONFIDENCE_THRESHOLD
  )

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleApprove = async (ticket: SidequestTicket, approveChildren = false) => {
    try {
      const response = await fetch(
        `/api/projects/${projectId}/sidequests/${sidequestId}/tickets/${ticket.id}/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approve_children: approveChildren }),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to approve')
      }

      toast({ title: 'Approved', description: `${ticket.title} approved` })
      onRefresh?.()
    } catch (error) {
      console.error('Approve error:', error)
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to approve', variant: 'destructive' })
    }
  }

  const handleDelete = async (ticketId: string) => {
    try {
      const response = await fetch(
        `/api/projects/${projectId}/sidequests/${sidequestId}/tickets/${ticketId}`,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete')
      }

      toast({ title: 'Deleted', description: 'Ticket deleted' })
      onTicketDelete?.(ticketId)
      onRefresh?.()
    } catch (error) {
      console.error('Delete error:', error)
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to delete', variant: 'destructive' })
    }
  }

  const expandAll = () => {
    setExpandedIds(new Set(tickets.map((t) => t.id)))
  }

  const collapseAll = () => {
    setExpandedIds(new Set())
  }

  const approveSelected = async () => {
    for (const id of Array.from(selectedIds)) {
      const ticket = tickets.find((t) => t.id === id)
      if (ticket && ticket.status === 'PENDING') {
        await handleApprove(ticket)
      }
    }
    setSelectedIds(new Set())
  }

  // Approve all high-confidence tickets at once
  const approveHighConfidence = async () => {
    if (highConfidenceTickets.length === 0) return

    let approved = 0
    for (const ticket of highConfidenceTickets) {
      try {
        const response = await fetch(
          `/api/projects/${projectId}/sidequests/${sidequestId}/tickets/${ticket.id}/approve`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approve_children: false }),
          }
        )
        if (response.ok) approved++
      } catch (error) {
        console.error('Approve error:', error)
      }
    }

    toast({ title: 'Approved', description: `${approved} high-confidence tickets approved` })
    onRefresh?.()
  }

  // Select all low-confidence tickets for review
  const selectLowConfidence = () => {
    setSelectedIds(new Set(lowConfidenceTickets.map((t) => t.id)))
    // Also expand all to make them visible
    expandAll()
    toast({ title: 'Selected for Review', description: `${lowConfidenceTickets.length} tickets need your review` })
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* View mode toggle */}
              <div className="flex items-center border rounded-md">
                <Button
                  variant={viewMode === 'tree' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="rounded-r-none"
                  onClick={() => setViewMode('tree')}
                >
                  <TreePine className="h-4 w-4 mr-1" />
                  Tree
                </Button>
                <Button
                  variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="rounded-none border-l"
                  onClick={() => setViewMode('table')}
                >
                  <Table2 className="h-4 w-4 mr-1" />
                  Table
                </Button>
                <Button
                  variant={viewMode === 'sprint' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="rounded-none border-x"
                  onClick={() => setViewMode('sprint')}
                >
                  <Layers className="h-4 w-4 mr-1" />
                  Sprints
                </Button>
                <Button
                  variant={viewMode === 'priority' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="rounded-l-none"
                  onClick={() => setViewMode('priority')}
                >
                  <LayoutList className="h-4 w-4 mr-1" />
                  Priority
                </Button>
              </div>
              <div className="border-l h-6 mx-2" />
              <Button variant="outline" size="sm" onClick={expandAll}>
                Expand All
              </Button>
              <Button variant="outline" size="sm" onClick={collapseAll}>
                Collapse All
              </Button>
            </div>
            {!readonly && selectedIds.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {selectedIds.size} selected
                </span>
                <Button size="sm" onClick={approveSelected}>
                  <Check className="h-4 w-4 mr-1" />
                  Approve Selected
                </Button>
              </div>
            )}
          </div>

        {/* Confidence-based actions */}
        {!readonly && pendingTickets.length > 0 && (
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-muted-foreground">
                <strong>{pendingTickets.length}</strong> pending tickets
              </span>
              {highConfidenceTickets.length > 0 && (
                <span className="text-green-600 flex items-center gap-1">
                  <Check className="h-3 w-3" />
                  <strong>{highConfidenceTickets.length}</strong> high confidence (≥70%)
                </span>
              )}
              {lowConfidenceTickets.length > 0 && (
                <span className="text-amber-600 flex items-center gap-1">
                  <strong>{lowConfidenceTickets.length}</strong> need review (&lt;70%)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {lowConfidenceTickets.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectLowConfidence}
                >
                  Review Low Confidence
                </Button>
              )}
              {highConfidenceTickets.length > 0 && (
                <Button
                  size="sm"
                  onClick={approveHighConfidence}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Check className="h-4 w-4 mr-1" />
                  Approve High Confidence ({highConfidenceTickets.length})
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

        {/* Content based on view mode */}
        {tickets.length > 0 ? (
          <>
            {viewMode === 'tree' && (
              <div className="space-y-2">
                {tree.map((ticket) => (
                  <TreeNode
                    key={ticket.id}
                    ticket={ticket}
                    depth={0}
                    expandedIds={expandedIds}
                    selectedIds={selectedIds}
                    onToggleExpand={toggleExpand}
                    onToggleSelect={toggleSelect}
                    onApprove={handleApprove}
                    onDelete={handleDelete}
                    readonly={readonly}
                  />
                ))}
              </div>
            )}

            {viewMode === 'table' && (
              <TicketTable
                tickets={tickets}
                selectedIds={selectedIds}
                expandedIds={expandedIds}
                onToggleSelect={toggleSelect}
                onToggleExpand={toggleExpand}
                onApprove={handleApprove}
                onDelete={handleDelete}
                readonly={readonly}
              />
            )}

            {viewMode === 'sprint' && (
              <div className="space-y-6">
                {Object.keys(sprintGroups)
                  .map(Number)
                  .sort((a, b) => a - b)
                  .map((sprint) => (
                    <div key={sprint} className="space-y-2">
                      <div className="flex items-center gap-2 pb-2 border-b">
                        <Layers className="h-4 w-4 text-primary" />
                        <h3 className="font-semibold">
                          {sprint === 0 ? 'Unassigned' : `Sprint ${sprint}`}
                        </h3>
                        <Badge variant="secondary">{sprintGroups[sprint].length} tickets</Badge>
                      </div>
                      {sprintGroups[sprint].map((ticket) => (
                        <FlatTicketCard
                          key={ticket.id}
                          ticket={ticket}
                          selectedIds={selectedIds}
                          onToggleSelect={toggleSelect}
                          onApprove={handleApprove}
                          onDelete={handleDelete}
                          readonly={readonly}
                        />
                      ))}
                    </div>
                  ))}
              </div>
            )}

            {viewMode === 'priority' && (
              <div className="space-y-6">
                {['URGENT', 'HIGH', 'MEDIUM', 'LOW', 'Unset'].map((priority) => {
                  const group = priorityGroups[priority]
                  if (!group || group.length === 0) return null
                  return (
                    <div key={priority} className="space-y-2">
                      <div className="flex items-center gap-2 pb-2 border-b">
                        <LayoutList className="h-4 w-4 text-primary" />
                        <h3 className="font-semibold">{priority}</h3>
                        <Badge
                          variant={priority === 'URGENT' || priority === 'HIGH' ? 'destructive' : 'secondary'}
                        >
                          {group.length} tickets
                        </Badge>
                      </div>
                      {group.map((ticket) => (
                        <FlatTicketCard
                          key={ticket.id}
                          ticket={ticket}
                          selectedIds={selectedIds}
                          onToggleSelect={toggleSelect}
                          onApprove={handleApprove}
                          onDelete={handleDelete}
                          readonly={readonly}
                        />
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        ) : (
          <Card className="p-8 text-center text-muted-foreground">
            <p>No tickets in this sidequest yet.</p>
            <p className="text-sm mt-1">Start chatting to generate a plan!</p>
          </Card>
        )}
      </div>
    </TooltipProvider>
  )
}

interface TreeNodeProps {
  ticket: TreeTicket
  depth: number
  expandedIds: Set<string>
  selectedIds: Set<string>
  onToggleExpand: (id: string) => void
  onToggleSelect: (id: string) => void
  onApprove: (ticket: SidequestTicket, approveChildren?: boolean) => void
  onDelete: (id: string) => void
  readonly: boolean
}

function TreeNode({
  ticket,
  depth,
  expandedIds,
  selectedIds,
  onToggleExpand,
  onToggleSelect,
  onApprove,
  onDelete,
  readonly,
}: TreeNodeProps) {
  const isExpanded = expandedIds.has(ticket.id)
  const isSelected = selectedIds.has(ticket.id)
  const hasChildren = ticket.children && ticket.children.length > 0
  const typeConfig = TICKET_TYPE_CONFIG[ticket.ticket_type]
  const statusConfig = STATUS_CONFIG[ticket.status]
  const TypeIcon = typeConfig.icon

  return (
    <div>
      <Card
        className={`transition-colors ${
          isSelected ? 'border-primary bg-primary/5' : ''
        } ${ticket.status === 'COMPLETED' ? 'opacity-60' : ''}`}
      >
        <div
          className="flex items-center gap-2 p-3"
          style={{ paddingLeft: `${depth * 24 + 12}px` }}
        >
          {/* Expand/collapse */}
          {hasChildren ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => onToggleExpand(ticket.id)}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          ) : (
            <div className="w-6" />
          )}

          {/* Selection checkbox */}
          {!readonly && ticket.status === 'PENDING' && (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelect(ticket.id)}
              className="shrink-0"
            />
          )}

          {/* Type icon */}
          <div className={`p-1.5 rounded ${typeConfig.bgColor} shrink-0`}>
            <TypeIcon className={`h-4 w-4 ${typeConfig.color}`} />
          </div>

          {/* Title and details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{ticket.title}</span>
              <Badge variant={statusConfig.variant} className="shrink-0 text-xs">
                {statusConfig.label}
              </Badge>
              {ticket.priority && (
                <Badge
                  variant={ticket.priority === 'URGENT' || ticket.priority === 'HIGH' ? 'destructive' : 'outline'}
                  className="shrink-0 text-xs"
                >
                  {ticket.priority}
                </Badge>
              )}
              {ticket.story_points && (
                <Badge variant="outline" className="shrink-0 text-xs">
                  {ticket.story_points} pts
                </Badge>
              )}
              {ticket.sprint_group && (
                <Badge variant="secondary" className="shrink-0 text-xs">
                  Sprint {ticket.sprint_group}
                </Badge>
              )}
              {ticket.confidence_score !== null && ticket.confidence_score !== undefined && (
                <Badge
                  variant="outline"
                  className={`shrink-0 text-xs ${
                    ticket.confidence_score >= 0.7
                      ? 'bg-green-50 text-green-700 border-green-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}
                >
                  {Math.round(ticket.confidence_score * 100)}% conf</Badge>
              )}
              {/* Context badges */}
              <ContextBadges ticket={ticket} />
            </div>
            {ticket.description && (
              <p className="text-sm text-muted-foreground truncate mt-0.5">
                {ticket.description}
              </p>
            )}
          </div>

          {/* Actions */}
          {!readonly && (
            <div className="flex items-center gap-1 shrink-0">
              {ticket.status === 'PENDING' && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                  onClick={() => onApprove(ticket, hasChildren)}
                  title={hasChildren ? 'Approve with children' : 'Approve'}
                >
                  <Check className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => onDelete(ticket.id)}
                title="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="mt-2 space-y-2">
          {ticket.children!.map((child) => (
            <TreeNode
              key={child.id}
              ticket={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              selectedIds={selectedIds}
              onToggleExpand={onToggleExpand}
              onToggleSelect={onToggleSelect}
              onApprove={onApprove}
              onDelete={onDelete}
              readonly={readonly}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Context badges component to show linked docs/repos/features
function ContextBadges({ ticket }: { ticket: SidequestTicket }) {
  const hasDocs = ticket.linked_doc_ids && ticket.linked_doc_ids.length > 0
  const hasRepos = ticket.linked_repo_ids && ticket.linked_repo_ids.length > 0
  const hasFeatures = ticket.linked_feature_ids && ticket.linked_feature_ids.length > 0

  if (!hasDocs && !hasRepos && !hasFeatures) return null

  return (
    <div className="flex items-center gap-1 shrink-0">
      {hasDocs && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-xs">
              <FileText className="h-3 w-3" />
              <span>{ticket.linked_doc_ids!.length}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {ticket.linked_doc_ids!.length} linked document(s)
          </TooltipContent>
        </Tooltip>
      )}
      {hasRepos && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-green-50 text-green-600 text-xs">
              <GitBranch className="h-3 w-3" />
              <span>{ticket.linked_repo_ids!.length}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {ticket.linked_repo_ids!.length} linked repository(ies)
          </TooltipContent>
        </Tooltip>
      )}
      {hasFeatures && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 text-xs">
              <Box className="h-3 w-3" />
              <span>{ticket.linked_feature_ids!.length}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {ticket.linked_feature_ids!.length} linked feature(s)
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

// Flat ticket card for sprint/priority views
interface FlatTicketCardProps {
  ticket: SidequestTicket
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onApprove: (ticket: SidequestTicket, approveChildren?: boolean) => void
  onDelete: (id: string) => void
  readonly: boolean
}

function FlatTicketCard({
  ticket,
  selectedIds,
  onToggleSelect,
  onApprove,
  onDelete,
  readonly,
}: FlatTicketCardProps) {
  const isSelected = selectedIds.has(ticket.id)
  const typeConfig = TICKET_TYPE_CONFIG[ticket.ticket_type]
  const statusConfig = STATUS_CONFIG[ticket.status]
  const TypeIcon = typeConfig.icon

  return (
    <Card
      className={`transition-colors ${
        isSelected ? 'border-primary bg-primary/5' : ''
      } ${ticket.status === 'COMPLETED' ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-2 p-3">
        {/* Selection checkbox */}
        {!readonly && ticket.status === 'PENDING' && (
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect(ticket.id)}
            className="shrink-0"
          />
        )}

        {/* Type icon */}
        <div className={`p-1.5 rounded ${typeConfig.bgColor} shrink-0`}>
          <TypeIcon className={`h-4 w-4 ${typeConfig.color}`} />
        </div>

        {/* Title and details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{ticket.title}</span>
            <Badge variant="outline" className="shrink-0 text-xs">
              {ticket.ticket_type}
            </Badge>
            <Badge variant={statusConfig.variant} className="shrink-0 text-xs">
              {statusConfig.label}
            </Badge>
            {ticket.priority && (
              <Badge
                variant={ticket.priority === 'URGENT' || ticket.priority === 'HIGH' ? 'destructive' : 'outline'}
                className="shrink-0 text-xs"
              >
                {ticket.priority}
              </Badge>
            )}
            {ticket.story_points && (
              <Badge variant="outline" className="shrink-0 text-xs">
                {ticket.story_points} pts
              </Badge>
            )}
            {ticket.sprint_group && (
              <Badge variant="secondary" className="shrink-0 text-xs">
                Sprint {ticket.sprint_group}
              </Badge>
            )}
            {/* Context badges */}
            <ContextBadges ticket={ticket} />
          </div>
          {ticket.description && (
            <p className="text-sm text-muted-foreground truncate mt-0.5">
              {ticket.description}
            </p>
          )}
        </div>

        {/* Actions */}
        {!readonly && (
          <div className="flex items-center gap-1 shrink-0">
            {ticket.status === 'PENDING' && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                onClick={() => onApprove(ticket)}
                title="Approve"
              >
                <Check className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => onDelete(ticket.id)}
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}

// Jira-like table view component with expandable rows
interface TicketTableProps {
  tickets: SidequestTicket[]
  selectedIds: Set<string>
  expandedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleExpand: (id: string) => void
  onApprove: (ticket: SidequestTicket, approveChildren?: boolean) => void
  onDelete: (id: string) => void
  readonly: boolean
}

function TicketTable({
  tickets,
  selectedIds,
  expandedIds,
  onToggleSelect,
  onToggleExpand,
  onApprove,
  onDelete,
  readonly,
}: TicketTableProps) {
  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Table header */}
      <div className="grid grid-cols-[auto_auto_1fr_100px_80px_80px_80px_auto] gap-2 p-3 bg-muted/50 border-b font-medium text-sm">
        <div className="w-6" /> {/* Expand button */}
        <div className="w-8" /> {/* Checkbox */}
        <div>Title</div>
        <div>Type</div>
        <div>Status</div>
        <div>Priority</div>
        <div>Context</div>
        <div className="w-20 text-right">Actions</div>
      </div>

      {/* Table rows */}
      <div className="divide-y">
        {tickets.map((ticket) => (
          <TicketTableRow
            key={ticket.id}
            ticket={ticket}
            isSelected={selectedIds.has(ticket.id)}
            isExpanded={expandedIds.has(ticket.id)}
            onToggleSelect={onToggleSelect}
            onToggleExpand={onToggleExpand}
            onApprove={onApprove}
            onDelete={onDelete}
            readonly={readonly}
          />
        ))}
      </div>
    </div>
  )
}

interface TicketTableRowProps {
  ticket: SidequestTicket
  isSelected: boolean
  isExpanded: boolean
  onToggleSelect: (id: string) => void
  onToggleExpand: (id: string) => void
  onApprove: (ticket: SidequestTicket, approveChildren?: boolean) => void
  onDelete: (id: string) => void
  readonly: boolean
}

function TicketTableRow({
  ticket,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleExpand,
  onApprove,
  onDelete,
  readonly,
}: TicketTableRowProps) {
  const typeConfig = TICKET_TYPE_CONFIG[ticket.ticket_type]
  const statusConfig = STATUS_CONFIG[ticket.status]
  const TypeIcon = typeConfig.icon

  const hasContext =
    (ticket.linked_doc_ids && ticket.linked_doc_ids.length > 0) ||
    (ticket.linked_repo_ids && ticket.linked_repo_ids.length > 0) ||
    (ticket.linked_feature_ids && ticket.linked_feature_ids.length > 0) ||
    (ticket.context_analysis && (
      ticket.context_analysis.suggested_docs?.length ||
      ticket.context_analysis.suggested_repos?.length ||
      ticket.context_analysis.suggested_features?.length ||
      ticket.context_analysis.key_files?.length
    ))

  return (
    <div className={`${isSelected ? 'bg-primary/5' : ''} ${ticket.status === 'COMPLETED' ? 'opacity-60' : ''}`}>
      {/* Main row */}
      <div className="grid grid-cols-[auto_auto_1fr_100px_80px_80px_80px_auto] gap-2 p-3 items-center text-sm">
        {/* Expand button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onToggleExpand(ticket.id)}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>

        {/* Selection checkbox */}
        {!readonly && ticket.status === 'PENDING' ? (
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect(ticket.id)}
            className="shrink-0"
          />
        ) : (
          <div className="w-4" />
        )}

        {/* Title */}
        <div className="flex items-center gap-2 min-w-0">
          <div className={`p-1 rounded ${typeConfig.bgColor} shrink-0`}>
            <TypeIcon className={`h-3.5 w-3.5 ${typeConfig.color}`} />
          </div>
          <span className="font-medium truncate">{ticket.title}</span>
        </div>

        {/* Type */}
        <Badge variant="outline" className="text-xs w-fit">
          {ticket.ticket_type}
        </Badge>

        {/* Status */}
        <Badge variant={statusConfig.variant} className="text-xs w-fit">
          {statusConfig.label}
        </Badge>

        {/* Priority */}
        {ticket.priority ? (
          <Badge
            variant={ticket.priority === 'URGENT' || ticket.priority === 'HIGH' ? 'destructive' : 'outline'}
            className="text-xs w-fit"
          >
            {ticket.priority}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-xs">-</span>
        )}

        {/* Context indicators */}
        <ContextBadges ticket={ticket} />

        {/* Actions */}
        {!readonly && (
          <div className="flex items-center gap-1 justify-end">
            {ticket.status === 'PENDING' && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
                onClick={() => onApprove(ticket)}
                title="Approve"
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => onDelete(ticket.id)}
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Expanded context panel */}
      {isExpanded && (
        <div className="px-12 pb-4 space-y-3 bg-muted/30">
          {/* Description */}
          {ticket.description && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-1">Description</h4>
              <p className="text-sm">{ticket.description}</p>
            </div>
          )}

          {/* Acceptance Criteria */}
          {ticket.acceptance_criteria && ticket.acceptance_criteria.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-1">Acceptance Criteria</h4>
              <ul className="text-sm list-disc list-inside space-y-0.5">
                {ticket.acceptance_criteria.map((criteria, i) => (
                  <li key={i}>{criteria}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Linked Context */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Linked Documents */}
            {ticket.linked_doc_ids && ticket.linked_doc_ids.length > 0 && (
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                <h4 className="text-xs font-semibold text-blue-700 mb-2 flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  Linked Documents ({ticket.linked_doc_ids.length})
                </h4>
                <ul className="text-sm text-blue-600 space-y-1">
                  {ticket.linked_doc_ids.map((id) => (
                    <li key={id} className="truncate">• {id.slice(0, 8)}...</li>
                  ))}
                </ul>
                {ticket.context_analysis?.suggested_docs && ticket.context_analysis.suggested_docs.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-blue-200">
                    <span className="text-xs text-blue-500">AI Suggestions:</span>
                    <ul className="text-xs text-blue-600 mt-1 space-y-0.5">
                      {ticket.context_analysis.suggested_docs.slice(0, 3).map((doc, i) => (
                        <li key={i} className="truncate">
                          {doc.title || doc.id?.slice(0, 8)} - {Math.round((doc.confidence || 0) * 100)}%
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Linked Repositories */}
            {ticket.linked_repo_ids && ticket.linked_repo_ids.length > 0 && (
              <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                <h4 className="text-xs font-semibold text-green-700 mb-2 flex items-center gap-1">
                  <GitBranch className="h-3.5 w-3.5" />
                  Linked Repositories ({ticket.linked_repo_ids.length})
                </h4>
                <ul className="text-sm text-green-600 space-y-1">
                  {ticket.linked_repo_ids.map((id) => (
                    <li key={id} className="truncate">• {id.slice(0, 8)}...</li>
                  ))}
                </ul>
                {ticket.context_analysis?.suggested_repos && ticket.context_analysis.suggested_repos.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-green-200">
                    <span className="text-xs text-green-500">AI Suggestions:</span>
                    <ul className="text-xs text-green-600 mt-1 space-y-0.5">
                      {ticket.context_analysis.suggested_repos.slice(0, 3).map((repo, i) => (
                        <li key={i} className="truncate">
                          {repo.name || repo.id?.slice(0, 8)} - {Math.round((repo.confidence || 0) * 100)}%
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Linked Features */}
            {ticket.linked_feature_ids && ticket.linked_feature_ids.length > 0 && (
              <div className="p-3 bg-purple-50 rounded-lg border border-purple-100">
                <h4 className="text-xs font-semibold text-purple-700 mb-2 flex items-center gap-1">
                  <Box className="h-3.5 w-3.5" />
                  Linked Features ({ticket.linked_feature_ids.length})
                </h4>
                <ul className="text-sm text-purple-600 space-y-1">
                  {ticket.linked_feature_ids.map((id) => (
                    <li key={id} className="truncate">• {id.slice(0, 8)}...</li>
                  ))}
                </ul>
                {ticket.context_analysis?.suggested_features && ticket.context_analysis.suggested_features.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-purple-200">
                    <span className="text-xs text-purple-500">AI Suggestions:</span>
                    <ul className="text-xs text-purple-600 mt-1 space-y-0.5">
                      {ticket.context_analysis.suggested_features.slice(0, 3).map((feature, i) => (
                        <li key={i} className="truncate">
                          {feature.name || feature.id?.slice(0, 8)} - {Math.round((feature.confidence || 0) * 100)}%
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Key Files */}
          {ticket.context_analysis?.key_files && ticket.context_analysis.key_files.length > 0 && (
            <div className="p-3 bg-amber-50 rounded-lg border border-amber-100">
              <h4 className="text-xs font-semibold text-amber-700 mb-2 flex items-center gap-1">
                <FileText className="h-3.5 w-3.5" />
                Key Files ({ticket.context_analysis.key_files.length})
              </h4>
              <ul className="text-sm text-amber-600 space-y-1 font-mono">
                {ticket.context_analysis.key_files.map((file, i) => (
                  <li key={i} className="truncate">
                    • {file.path}
                    {file.relevance && <span className="text-amber-500 font-sans text-xs ml-2">({file.relevance})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* No context message */}
          {!hasContext && !ticket.description && (!ticket.acceptance_criteria || ticket.acceptance_criteria.length === 0) && (
            <p className="text-sm text-muted-foreground italic">
              No additional context available. Use "Add Context" to analyze and link relevant resources.
            </p>
          )}

          {/* Metadata */}
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground pt-2 border-t">
            {ticket.story_points && <span>Story Points: {ticket.story_points}</span>}
            {ticket.sprint_group && <span>Sprint: {ticket.sprint_group}</span>}
            {ticket.confidence_score !== null && ticket.confidence_score !== undefined && (
              <span className={ticket.confidence_score >= 0.7 ? 'text-green-600' : 'text-amber-600'}>
                Confidence: {Math.round(ticket.confidence_score * 100)}%
              </span>
            )}
            {ticket.context_analysis?.analyzed_at && (
              <span>Last analyzed: {new Date(ticket.context_analysis.analyzed_at).toLocaleDateString()}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
