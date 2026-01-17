'use client'

import { useState } from 'react'
import { SidequestCard } from './sidequest-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Search, Sparkles } from 'lucide-react'
import type { Sidequest } from '@laneshare/shared'

interface SidequestListProps {
  sidequests: Sidequest[]
  projectId: string
  onCreateNew: () => void
}

type FilterStatus = 'all' | 'active' | 'completed' | 'archived'

export function SidequestList({ sidequests, projectId, onCreateNew }: SidequestListProps) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')

  const filteredSidequests = sidequests.filter((sq) => {
    // Search filter
    if (search) {
      const searchLower = search.toLowerCase()
      const matchesTitle = sq.title.toLowerCase().includes(searchLower)
      const matchesDescription = sq.description?.toLowerCase().includes(searchLower)
      if (!matchesTitle && !matchesDescription) return false
    }

    // Status filter
    switch (statusFilter) {
      case 'active':
        return ['PLANNING', 'READY', 'IN_PROGRESS', 'PAUSED'].includes(sq.status)
      case 'completed':
        return sq.status === 'COMPLETED'
      case 'archived':
        return sq.status === 'ARCHIVED'
      default:
        return true
    }
  })

  const stats = {
    total: sidequests.length,
    planning: sidequests.filter((sq) => sq.status === 'PLANNING').length,
    inProgress: sidequests.filter((sq) => sq.status === 'IN_PROGRESS').length,
    completed: sidequests.filter((sq) => sq.status === 'COMPLETED').length,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            Sidequests
          </h1>
          <p className="text-muted-foreground mt-1">
            Plan and implement features with AI assistance
          </p>
        </div>
        <Button onClick={onCreateNew}>
          <Plus className="h-4 w-4 mr-2" />
          New Sidequest
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-muted/50 rounded-lg p-4">
          <div className="text-2xl font-bold">{stats.total}</div>
          <div className="text-sm text-muted-foreground">Total</div>
        </div>
        <div className="bg-muted/50 rounded-lg p-4">
          <div className="text-2xl font-bold">{stats.planning}</div>
          <div className="text-sm text-muted-foreground">Planning</div>
        </div>
        <div className="bg-muted/50 rounded-lg p-4">
          <div className="text-2xl font-bold">{stats.inProgress}</div>
          <div className="text-sm text-muted-foreground">In Progress</div>
        </div>
        <div className="bg-muted/50 rounded-lg p-4">
          <div className="text-2xl font-bold">{stats.completed}</div>
          <div className="text-sm text-muted-foreground">Completed</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search sidequests..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as FilterStatus)}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sidequests</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Grid */}
      {filteredSidequests.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSidequests.map((sidequest) => (
            <SidequestCard key={sidequest.id} sidequest={sidequest} projectId={projectId} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-muted/30 rounded-lg">
          <Sparkles className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          {sidequests.length === 0 ? (
            <>
              <h3 className="text-lg font-medium mb-2">No sidequests yet</h3>
              <p className="text-muted-foreground mb-4">
                Create your first sidequest to start planning with AI
              </p>
              <Button onClick={onCreateNew}>
                <Plus className="h-4 w-4 mr-2" />
                New Sidequest
              </Button>
            </>
          ) : (
            <>
              <h3 className="text-lg font-medium mb-2">No matching sidequests</h3>
              <p className="text-muted-foreground">Try adjusting your search or filters</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
