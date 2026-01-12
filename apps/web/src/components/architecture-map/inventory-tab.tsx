'use client'

import { useState, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Search,
  Monitor,
  Server,
  Database,
  Cloud,
  Lock,
  HardDrive,
  Package,
  Box,
  GitBranch,
  ChevronRight,
  ArrowUpDown,
} from 'lucide-react'
import type { ArchNode, NodeType, Feature } from '@laneshare/shared'

interface InventoryTabProps {
  nodes: ArchNode[]
  features: Feature[]
  onNodeClick: (nodeId: string, label: string) => void
}

const nodeTypeIcons: Record<NodeType, typeof Monitor> = {
  repo: GitBranch,
  app: Box,
  screen: Monitor,
  endpoint: Server,
  worker: Server,
  table: Database,
  function: Database,
  storage: HardDrive,
  auth: Lock,
  external_service: Cloud,
  deployment: Cloud,
  package: Package,
}

type SortField = 'label' | 'type' | 'features'
type SortOrder = 'asc' | 'desc'

export function InventoryTab({ nodes, features, onNodeClick }: InventoryTabProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [sortField, setSortField] = useState<SortField>('type')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  // Create a map of node ID to features
  const nodeFeatures = useMemo(() => {
    const map = new Map<string, string[]>()

    for (const feature of features) {
      for (const nodeId of [...feature.screens, ...feature.endpoints, ...feature.tables, ...feature.services]) {
        if (!map.has(nodeId)) {
          map.set(nodeId, [])
        }
        map.get(nodeId)!.push(feature.name)
      }
    }

    return map
  }, [features])

  // Get unique types for filter
  const availableTypes = useMemo(() => {
    const types = new Set<NodeType>()
    for (const node of nodes) {
      types.add(node.type)
    }
    return Array.from(types).sort()
  }, [nodes])

  // Filter and sort nodes
  const filteredNodes = useMemo(() => {
    let result = nodes.filter((node) => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        if (!node.label.toLowerCase().includes(query)) {
          return false
        }
      }
      if (typeFilter !== 'all' && node.type !== typeFilter) {
        return false
      }
      return true
    })

    // Sort
    result.sort((a, b) => {
      let comparison = 0

      switch (sortField) {
        case 'label':
          comparison = a.label.localeCompare(b.label)
          break
        case 'type':
          comparison = a.type.localeCompare(b.type)
          break
        case 'features':
          const aCount = nodeFeatures.get(a.id)?.length || 0
          const bCount = nodeFeatures.get(b.id)?.length || 0
          comparison = aCount - bCount
          break
      }

      return sortOrder === 'asc' ? comparison : -comparison
    })

    return result
  }, [nodes, searchQuery, typeFilter, sortField, sortOrder, nodeFeatures])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  // Group by type for summary
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const node of nodes) {
      counts[node.type] = (counts[node.type] || 0) + 1
    }
    return counts
  }, [nodes])

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid gap-2 grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
        {availableTypes.map((type) => {
          const Icon = nodeTypeIcons[type]
          const count = typeCounts[type] || 0
          const isSelected = typeFilter === type

          return (
            <Card
              key={type}
              className={`cursor-pointer transition-colors ${
                isSelected ? 'border-primary bg-primary/5' : 'hover:border-primary/50'
              }`}
              onClick={() => setTypeFilter(isSelected ? 'all' : type)}
            >
              <CardContent className="pt-3 pb-2 px-3">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-lg font-semibold">{count}</span>
                </div>
                <div className="text-xs text-muted-foreground capitalize">
                  {type.replace('_', ' ')}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Search and Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search nodes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {availableTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {type.replace('_', ' ')} ({typeCounts[type]})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 -ml-2 font-medium"
                    onClick={() => toggleSort('type')}
                  >
                    Type
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                </th>
                <th className="text-left p-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 -ml-2 font-medium"
                    onClick={() => toggleSort('label')}
                  >
                    Name
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                </th>
                <th className="text-left p-3">
                  <span className="font-medium text-sm">Details</span>
                </th>
                <th className="text-left p-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 -ml-2 font-medium"
                    onClick={() => toggleSort('features')}
                  >
                    Features
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                </th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filteredNodes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-muted-foreground">
                    No nodes match your filters
                  </td>
                </tr>
              ) : (
                filteredNodes.map((node) => {
                  const Icon = nodeTypeIcons[node.type]
                  const nodeFeatureList = nodeFeatures.get(node.id) || []

                  return (
                    <tr
                      key={node.id}
                      className="border-b last:border-b-0 hover:bg-muted/50 cursor-pointer"
                      onClick={() => onNodeClick(node.id, node.label)}
                    >
                      <td className="p-3">
                        <Badge variant="outline" className="capitalize">
                          <Icon className="h-3 w-3 mr-1" />
                          {node.type.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <span className="font-medium">{node.label}</span>
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {getNodeDetails(node)}
                      </td>
                      <td className="p-3">
                        {nodeFeatureList.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {nodeFeatureList.slice(0, 3).map((feature) => (
                              <Badge key={feature} variant="secondary" className="text-xs">
                                {feature}
                              </Badge>
                            ))}
                            {nodeFeatureList.length > 3 && (
                              <Badge variant="secondary" className="text-xs">
                                +{nodeFeatureList.length - 3}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </td>
                      <td className="p-3">
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredNodes.length > 0 && (
          <div className="p-3 border-t text-sm text-muted-foreground">
            Showing {filteredNodes.length} of {nodes.length} nodes
          </div>
        )}
      </Card>
    </div>
  )
}

function getNodeDetails(node: ArchNode): string {
  const meta = node.metadata as Record<string, any>

  switch (node.type) {
    case 'screen':
      return meta.route || ''
    case 'endpoint':
      return `${meta.method} ${meta.route}`
    case 'table':
      return `${meta.columns?.length || 0} columns${meta.hasRls ? ', RLS' : ''}`
    case 'function':
      return meta.language || ''
    case 'repo':
      return `${meta.owner}/${meta.name}`
    case 'app':
      return meta.framework || ''
    case 'external_service':
      return meta.domain || ''
    case 'package':
      return meta.version || ''
    default:
      return ''
  }
}
