'use client'

import { useState, useEffect, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Search,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import type {
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSchemaRef,
} from '@/lib/supabase/types'

interface Endpoint {
  id: string
  asset_key: string
  method: string
  path: string
  operationId?: string
  summary?: string
  description?: string
  tags: string[]
  deprecated: boolean
  parameters?: OpenApiParameter[]
  requestBody?: OpenApiRequestBody
  responses?: Record<string, OpenApiResponse>
}

interface ConnectionInfo {
  id: string
  display_name: string
  status: string
  spec_title?: string
  spec_version?: string
  last_synced_at?: string
}

interface OpenApiEndpointsViewerProps {
  projectId: string
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  POST: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  PUT: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  PATCH: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  DELETE: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  OPTIONS: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  HEAD: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
}

export function OpenApiEndpointsViewer({ projectId }: OpenApiEndpointsViewerProps) {
  const { toast } = useToast()
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [connection, setConnection] = useState<ConnectionInfo | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTag, setSelectedTag] = useState<string>('')
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [pagination, setPagination] = useState({ offset: 0, limit: 50, total: 0, hasMore: false })

  const fetchEndpoints = useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      if (searchQuery) params.set('q', searchQuery)
      if (selectedTag) params.set('tag', selectedTag)
      params.set('limit', pagination.limit.toString())
      params.set('offset', pagination.offset.toString())

      const response = await fetch(
        `/api/projects/${projectId}/services/openapi/endpoints?${params}`
      )
      const data = await response.json()

      setEndpoints(data.endpoints || [])
      setConnection(data.connection)
      setTags(data.tags || [])
      setPagination((prev) => ({
        ...prev,
        total: data.total || 0,
        hasMore: data.pagination?.hasMore || false,
      }))
    } catch (error) {
      console.error('Failed to fetch endpoints:', error)
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load API endpoints',
      })
    } finally {
      setIsLoading(false)
    }
  }, [projectId, searchQuery, selectedTag, pagination.offset, pagination.limit, toast])

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      fetchEndpoints()
    }, 300)

    return () => clearTimeout(debounceTimer)
  }, [fetchEndpoints])

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
    toast({
      title: 'Copied',
      description: 'Copied to clipboard',
    })
  }

  const copyAsMarkdown = (endpoint: Endpoint) => {
    let md = `### ${endpoint.method} ${endpoint.path}\n\n`
    if (endpoint.summary) md += `${endpoint.summary}\n\n`
    if (endpoint.operationId) md += `**Operation ID:** \`${endpoint.operationId}\`\n\n`
    if (endpoint.tags.length > 0) md += `**Tags:** ${endpoint.tags.join(', ')}\n\n`

    if (endpoint.parameters && endpoint.parameters.length > 0) {
      md += `#### Parameters\n\n`
      md += `| Name | In | Type | Required | Description |\n`
      md += `|------|----|----- |----------|-------------|\n`
      for (const param of endpoint.parameters) {
        const type = param.schema?.type || '-'
        md += `| ${param.name} | ${param.in} | ${type} | ${param.required ? 'Yes' : 'No'} | ${param.description || '-'} |\n`
      }
      md += '\n'
    }

    if (endpoint.responses) {
      md += `#### Responses\n\n`
      for (const [code, response] of Object.entries(endpoint.responses)) {
        md += `- **${code}**: ${response.description || 'No description'}\n`
      }
    }

    return md
  }

  const copyAsEvidence = (endpoint: Endpoint) => {
    return JSON.stringify(
      {
        source_type: 'SERVICE',
        source_ref: endpoint.asset_key,
        excerpt: `${endpoint.method} ${endpoint.path} - ${endpoint.summary || endpoint.operationId || 'API endpoint'}`,
        metadata: {
          method: endpoint.method,
          path: endpoint.path,
          operationId: endpoint.operationId,
          tags: endpoint.tags,
        },
      },
      null,
      2
    )
  }

  const renderSchemaRef = (schema?: OpenApiSchemaRef): string => {
    if (!schema) return '-'
    if (schema.$ref) {
      const refName = schema.$ref.split('/').pop() || schema.$ref
      return refName
    }
    if (schema.type === 'array' && schema.items) {
      return `${renderSchemaRef(schema.items)}[]`
    }
    return schema.type || 'object'
  }

  if (!connection) {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )
    }
    return (
      <div className="text-center py-8 text-muted-foreground">
        No OpenAPI connection found. Connect an API spec to browse endpoints.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">
            {connection.spec_title || connection.display_name}
          </h3>
          <p className="text-sm text-muted-foreground">
            {pagination.total} endpoints
            {connection.spec_version && ` | v${connection.spec_version}`}
          </p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search endpoints by path, operationId, or summary..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setPagination((prev) => ({ ...prev, offset: 0 }))
            }}
            className="pl-10"
          />
        </div>
        <Select
          value={selectedTag}
          onValueChange={(value) => {
            setSelectedTag(value === 'all' ? '' : value)
            setPagination((prev) => ({ ...prev, offset: 0 }))
          }}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter by tag" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tags</SelectItem>
            {tags.map((tag) => (
              <SelectItem key={tag} value={tag}>
                {tag}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Endpoints Table */}
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Method</TableHead>
              <TableHead>Path</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead className="w-[150px]">Tags</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : endpoints.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No endpoints found
                </TableCell>
              </TableRow>
            ) : (
              endpoints.map((endpoint) => (
                <TableRow
                  key={endpoint.id}
                  className={`cursor-pointer hover:bg-muted/50 ${endpoint.deprecated ? 'opacity-60' : ''}`}
                  onClick={() => setSelectedEndpoint(endpoint)}
                >
                  <TableCell>
                    <Badge className={METHOD_COLORS[endpoint.method] || 'bg-gray-100'}>
                      {endpoint.method}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {endpoint.path}
                    {endpoint.deprecated && (
                      <Badge variant="outline" className="ml-2 text-xs">
                        deprecated
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[300px] truncate">
                    {endpoint.summary || endpoint.operationId || '-'}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {endpoint.tags.slice(0, 2).map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                      {endpoint.tags.length > 2 && (
                        <Badge variant="outline" className="text-xs">
                          +{endpoint.tags.length - 2}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedEndpoint(endpoint)
                      }}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {pagination.total > pagination.limit && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {pagination.offset + 1}-{Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagination((prev) => ({ ...prev, offset: Math.max(0, prev.offset - prev.limit) }))}
              disabled={pagination.offset === 0}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagination((prev) => ({ ...prev, offset: prev.offset + prev.limit }))}
              disabled={!pagination.hasMore}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Endpoint Detail Dialog */}
      <Dialog open={!!selectedEndpoint} onOpenChange={() => setSelectedEndpoint(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          {selectedEndpoint && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Badge className={METHOD_COLORS[selectedEndpoint.method] || 'bg-gray-100'}>
                    {selectedEndpoint.method}
                  </Badge>
                  <code className="font-mono">{selectedEndpoint.path}</code>
                </DialogTitle>
                <DialogDescription>
                  {selectedEndpoint.summary || selectedEndpoint.description || 'No description'}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 mt-4">
                {/* Metadata */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {selectedEndpoint.operationId && (
                    <div>
                      <span className="text-muted-foreground">Operation ID:</span>
                      <code className="ml-2 bg-muted px-1 rounded">{selectedEndpoint.operationId}</code>
                    </div>
                  )}
                  {selectedEndpoint.tags.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">Tags:</span>
                      <span className="ml-2">{selectedEndpoint.tags.join(', ')}</span>
                    </div>
                  )}
                </div>

                {/* Parameters */}
                {selectedEndpoint.parameters && selectedEndpoint.parameters.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2">Parameters</h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>In</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Required</TableHead>
                          <TableHead>Description</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedEndpoint.parameters.map((param, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono text-sm">{param.name}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{param.in}</Badge>
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {renderSchemaRef(param.schema)}
                            </TableCell>
                            <TableCell>{param.required ? 'Yes' : 'No'}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {param.description || '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Request Body */}
                {selectedEndpoint.requestBody && (
                  <div>
                    <h4 className="font-semibold mb-2">Request Body</h4>
                    <div className="text-sm">
                      {selectedEndpoint.requestBody.description && (
                        <p className="text-muted-foreground mb-2">
                          {selectedEndpoint.requestBody.description}
                        </p>
                      )}
                      {selectedEndpoint.requestBody.content && (
                        <div className="space-y-1">
                          {Object.entries(selectedEndpoint.requestBody.content).map(([type, content]) => (
                            <div key={type} className="flex items-center gap-2">
                              <Badge variant="outline">{type}</Badge>
                              <span className="font-mono text-sm">
                                {renderSchemaRef(content.schema)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Responses */}
                {selectedEndpoint.responses && Object.keys(selectedEndpoint.responses).length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2">Responses</h4>
                    <div className="space-y-2">
                      {Object.entries(selectedEndpoint.responses).map(([code, response]) => (
                        <div key={code} className="flex items-start gap-2 text-sm">
                          <Badge
                            variant={code.startsWith('2') ? 'default' : code.startsWith('4') || code.startsWith('5') ? 'destructive' : 'secondary'}
                          >
                            {code}
                          </Badge>
                          <span>{response.description || 'No description'}</span>
                          {response.content && (
                            <span className="text-muted-foreground">
                              ({Object.entries(response.content).map(([type, c]) => (
                                <span key={type} className="font-mono">
                                  {renderSchemaRef(c.schema)}
                                </span>
                              )).reduce((a, b) => <>{a}, {b}</>)})
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Copy Actions */}
                <div className="flex gap-2 pt-4 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy(copyAsMarkdown(selectedEndpoint), `md-${selectedEndpoint.id}`)}
                  >
                    {copiedId === `md-${selectedEndpoint.id}` ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : (
                      <Copy className="mr-2 h-4 w-4" />
                    )}
                    Copy as Markdown
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy(copyAsEvidence(selectedEndpoint), `ev-${selectedEndpoint.id}`)}
                  >
                    {copiedId === `ev-${selectedEndpoint.id}` ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : (
                      <Copy className="mr-2 h-4 w-4" />
                    )}
                    Copy as Evidence
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
