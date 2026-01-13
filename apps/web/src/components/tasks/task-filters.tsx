'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Search, X, Filter } from 'lucide-react'
import { SELECT_SENTINELS, sprintSelect, assigneeSelect } from '@laneshare/shared'
import type { Sprint, TaskStatus, TaskType, TaskPriority } from '@laneshare/shared'

interface Member {
  id: string
  email: string
  full_name: string | null
}

export interface TaskFilters {
  search: string
  status: TaskStatus | null
  type: TaskType | null
  priority: TaskPriority | null
  assigneeId: string | null
  sprintId: string | null
}

interface TaskFiltersBarProps {
  filters: TaskFilters
  onFiltersChange: (filters: TaskFilters) => void
  members: Member[]
  sprints: Sprint[]
  showSprintFilter?: boolean
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'BACKLOG', label: 'Backlog' },
  { value: 'TODO', label: 'To Do' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'IN_REVIEW', label: 'In Review' },
  { value: 'BLOCKED', label: 'Blocked' },
  { value: 'DONE', label: 'Done' },
]

const TYPE_OPTIONS: { value: TaskType; label: string }[] = [
  { value: 'EPIC', label: 'Epic' },
  { value: 'STORY', label: 'Story' },
  { value: 'TASK', label: 'Task' },
  { value: 'BUG', label: 'Bug' },
  { value: 'SPIKE', label: 'Spike' },
]

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
]

export function TaskFiltersBar({
  filters,
  onFiltersChange,
  members,
  sprints,
  showSprintFilter = true,
}: TaskFiltersBarProps) {
  const [showFilters, setShowFilters] = useState(false)

  const activeFilterCount = [
    filters.status,
    filters.type,
    filters.priority,
    filters.assigneeId,
    filters.sprintId,
  ].filter(Boolean).length

  const handleClearFilters = () => {
    onFiltersChange({
      search: '',
      status: null,
      type: null,
      priority: null,
      assigneeId: null,
      sprintId: null,
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={filters.search}
            onChange={(e) =>
              onFiltersChange({ ...filters, search: e.target.value })
            }
            className="pl-9"
          />
        </div>

        <Button
          variant={showFilters ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
          className="gap-2"
        >
          <Filter className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5">
              {activeFilterCount}
            </Badge>
          )}
        </Button>

        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearFilters}
            className="gap-1 text-muted-foreground"
          >
            <X className="h-4 w-4" />
            Clear
          </Button>
        )}
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-center gap-3 p-3 bg-muted/50 rounded-lg">
          <Select
            value={filters.status || SELECT_SENTINELS.ALL}
            onValueChange={(v) =>
              onFiltersChange({
                ...filters,
                status: v === SELECT_SENTINELS.ALL ? null : (v as TaskStatus),
              })
            }
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SELECT_SENTINELS.ALL}>All Status</SelectItem>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.type || SELECT_SENTINELS.ALL}
            onValueChange={(v) =>
              onFiltersChange({
                ...filters,
                type: v === SELECT_SENTINELS.ALL ? null : (v as TaskType),
              })
            }
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SELECT_SENTINELS.ALL}>All Types</SelectItem>
              {TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.priority || SELECT_SENTINELS.ALL}
            onValueChange={(v) =>
              onFiltersChange({
                ...filters,
                priority: v === SELECT_SENTINELS.ALL ? null : (v as TaskPriority),
              })
            }
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SELECT_SENTINELS.ALL}>All Priority</SelectItem>
              {PRIORITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={assigneeSelect.encode(filters.assigneeId)}
            onValueChange={(v) =>
              onFiltersChange({
                ...filters,
                assigneeId: assigneeSelect.decode(v),
              })
            }
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SELECT_SENTINELS.ALL}>All Assignees</SelectItem>
              <SelectItem value={SELECT_SENTINELS.UNASSIGNED}>Unassigned</SelectItem>
              {members.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.full_name || member.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {showSprintFilter && (
            <Select
              value={sprintSelect.encode(filters.sprintId)}
              onValueChange={(v) =>
                onFiltersChange({
                  ...filters,
                  sprintId: sprintSelect.decode(v),
                })
              }
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Sprint" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SELECT_SENTINELS.ALL}>All Sprints</SelectItem>
                <SelectItem value={SELECT_SENTINELS.NO_SPRINT}>Backlog (No Sprint)</SelectItem>
                {sprints.map((sprint) => (
                  <SelectItem key={sprint.id} value={sprint.id}>
                    {sprint.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </div>
  )
}

export const defaultFilters: TaskFilters = {
  search: '',
  status: null,
  type: null,
  priority: null,
  assigneeId: null,
  sprintId: null,
}
