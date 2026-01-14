'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useToast } from '@/hooks/use-toast'
import { Search, Loader2, Plus, Check, FileJson, Sparkles } from 'lucide-react'

interface EndpointMatch {
  id: string
  asset_key: string
  method: string
  path: string
  operationId?: string
  summary?: string
  tags: string[]
  api_name: string
  already_added: boolean
  match_confidence: 'HIGH' | 'MED' | 'LOW'
  suggested_excerpt: string
}

interface AddOpenApiEvidenceDialogProps {
  projectId: string
  systemId: string
  systemKeywords: string[]
  onEvidenceAdded: () => void
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  POST: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  PUT: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  PATCH: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  DELETE: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

const CONFIDENCE_COLORS: Record<string, string> = {
  HIGH: 'bg-green-100 text-green-800',
  MED: 'bg-yellow-100 text-yellow-800',
  LOW: 'bg-gray-100 text-gray-800',
}

export function AddOpenApiEvidenceDialog({
  projectId,
  systemId,
  systemKeywords,
  onEvidenceAdded,
}: AddOpenApiEvidenceDialogProps) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isAdding, setIsAdding] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [autoMatch, setAutoMatch] = useState(true)
  const [endpoints, setEndpoints] = useState<EndpointMatch[]>([])
  const [selectedConfidence, setSelectedConfidence] = useState<'HIGH' | 'MED' | 'LOW'>('HIGH')

  const fetchEndpoints = useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      if (searchQuery) params.set('q', searchQuery)
      if (autoMatch) params.set('auto', 'true')

      const response = await fetch(
        `/api/projects/${projectId}/systems/${systemId}/evidence/openapi?${params}`
      )
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch endpoints')
      }

      setEndpoints(data.endpoints || [])
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load endpoints',
      })
    } finally {
      setIsLoading(false)
    }
  }, [projectId, systemId, searchQuery, autoMatch, toast])

  useEffect(() => {
    if (open) {
      const debounceTimer = setTimeout(() => {
        fetchEndpoints()
      }, 300)

      return () => clearTimeout(debounceTimer)
    }
  }, [open, fetchEndpoints])

  const handleAdd = async (endpoint: EndpointMatch) => {
    setIsAdding(endpoint.id)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/systems/${systemId}/evidence/openapi`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            asset_id: endpoint.id,
            confidence: selectedConfidence,
            excerpt: endpoint.suggested_excerpt,
          }),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to add evidence')
      }

      toast({
        title: 'Evidence added',
        description: `${endpoint.method} ${endpoint.path} added as evidence`,
      })

      // Refresh the list
      fetchEndpoints()
      onEvidenceAdded()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add evidence',
      })
    } finally {
      setIsAdding(null)
    }
  }

  const availableEndpoints = endpoints.filter((ep) => !ep.already_added)
  const alreadyAddedCount = endpoints.filter((ep) => ep.already_added).length

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileJson className="mr-2 h-4 w-4" />
          Add from OpenAPI
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5" />
            Add OpenAPI Evidence
          </DialogTitle>
          <DialogDescription>
            Search API endpoints to add as grounding evidence for this system.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          {/* Search and filters */}
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by path, operationId, summary..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button
              variant={autoMatch ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAutoMatch(!autoMatch)}
              className="whitespace-nowrap"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Auto-match
            </Button>
          </div>

          {/* System keywords hint */}
          {autoMatch && systemKeywords.length > 0 && (
            <div className="text-sm text-muted-foreground">
              Matching against keywords:{' '}
              {systemKeywords.slice(0, 5).map((kw, i) => (
                <Badge key={i} variant="outline" className="ml-1 text-xs">
                  {kw}
                </Badge>
              ))}
              {systemKeywords.length > 5 && (
                <span className="ml-1">+{systemKeywords.length - 5} more</span>
              )}
            </div>
          )}

          {/* Confidence selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Default confidence:</span>
            <Select
              value={selectedConfidence}
              onValueChange={(v) => setSelectedConfidence(v as 'HIGH' | 'MED' | 'LOW')}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="MED">Medium</SelectItem>
                <SelectItem value="LOW">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto border rounded-md">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : availableEndpoints.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {alreadyAddedCount > 0 ? (
                  <>All matching endpoints have already been added ({alreadyAddedCount} total)</>
                ) : (
                  <>No endpoints found. Try adjusting your search.</>
                )}
              </div>
            ) : (
              <div className="divide-y">
                {availableEndpoints.map((endpoint) => (
                  <div
                    key={endpoint.id}
                    className="p-3 hover:bg-muted/50 flex items-start justify-between gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={METHOD_COLORS[endpoint.method] || 'bg-gray-100'}>
                          {endpoint.method}
                        </Badge>
                        <code className="font-mono text-sm truncate">{endpoint.path}</code>
                        {autoMatch && (
                          <Badge className={CONFIDENCE_COLORS[endpoint.match_confidence]}>
                            {endpoint.match_confidence}
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground truncate">
                        {endpoint.summary || endpoint.operationId || 'No description'}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {endpoint.api_name}
                        {endpoint.tags.length > 0 && (
                          <span className="ml-2">
                            Tags: {endpoint.tags.slice(0, 3).join(', ')}
                            {endpoint.tags.length > 3 && ` +${endpoint.tags.length - 3}`}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleAdd(endpoint)}
                      disabled={isAdding === endpoint.id}
                    >
                      {isAdding === endpoint.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {alreadyAddedCount > 0 && (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Check className="h-4 w-4 text-green-600" />
              {alreadyAddedCount} endpoint{alreadyAddedCount !== 1 ? 's' : ''} already added as evidence
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
