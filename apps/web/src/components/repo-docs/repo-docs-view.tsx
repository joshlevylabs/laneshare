'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import {
  Building2,
  Code2,
  Sparkles,
  Wrench,
  Search,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Clock,
  FileText,
  ChevronRight,
  History,
  Loader2,
  X,
  AlertTriangle,
} from 'lucide-react'
import type { RepoDocBundle, RepoDocPage, RepoDocCategory, RepoDocBundleSummary } from '@laneshare/shared'
import { REPO_DOC_CATEGORY_LABELS } from '@laneshare/shared'
import { DocPageViewer } from './doc-page-viewer'

interface RepoDocsViewProps {
  projectId: string
  repoId: string
  repo: {
    id: string
    owner: string
    name: string
    doc_status: string | null
    doc_bundle_id: string | null
  }
}

interface PageSummary {
  id: string
  category: RepoDocCategory
  slug: string
  title: string
  needs_review: boolean
  user_edited: boolean
}

interface DocGenProgress {
  stage: 'starting' | 'calling_api' | 'streaming' | 'parsing' | 'continuation' | 'complete' | 'error'
  message: string
  pagesGenerated: number
  round: number
  maxRounds: number
  continuationAttempt?: number
  lastUpdated?: string
  // Time estimation
  estimatedTotalSeconds?: number
  elapsedSeconds?: number
  // Streaming progress
  streamingPages?: string[]
}

const categoryIcons: Record<RepoDocCategory, React.ReactNode> = {
  ARCHITECTURE: <Building2 className="h-4 w-4" />,
  API: <Code2 className="h-4 w-4" />,
  FEATURE: <Sparkles className="h-4 w-4" />,
  RUNBOOK: <Wrench className="h-4 w-4" />,
}

export function RepoDocsView({ projectId, repoId, repo }: RepoDocsViewProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [bundle, setBundle] = useState<RepoDocBundle | null>(null)
  const [pages, setPages] = useState<PageSummary[]>([])
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<RepoDocCategory | 'ALL'>('ALL')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [docGenProgress, setDocGenProgress] = useState<DocGenProgress | null>(null)
  const [currentBundleId, setCurrentBundleId] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)

  // Check if progress is stale (no update for more than 2 minutes)
  const isProgressStale = (progress: DocGenProgress | null): boolean => {
    if (!progress?.lastUpdated) return false
    const lastUpdate = new Date(progress.lastUpdated).getTime()
    const now = Date.now()
    return now - lastUpdate > 2 * 60 * 1000 // 2 minutes
  }

  // Format seconds as "Xm Ys" or "Xs"
  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
  }

  // Get time remaining string
  const getTimeRemaining = (progress: DocGenProgress | null): string | null => {
    if (!progress?.estimatedTotalSeconds || !progress?.elapsedSeconds) return null
    const remaining = Math.max(0, progress.estimatedTotalSeconds - progress.elapsedSeconds)
    if (remaining === 0) return 'Almost done...'
    return `~${formatTime(remaining)} remaining`
  }

  const getDocStageLabel = (progress: DocGenProgress | null): string => {
    if (!progress) return 'Generating documentation...'
    switch (progress.stage) {
      case 'starting':
        return 'Initializing...'
      case 'calling_api':
        return `Round ${progress.round}/${progress.maxRounds}: Connecting to Claude...`
      case 'streaming':
        return `Round ${progress.round}/${progress.maxRounds}: Generating pages...`
      case 'parsing':
        return `Round ${progress.round}/${progress.maxRounds}: Processing response...`
      case 'continuation':
        return `Continuation ${progress.continuationAttempt}: Generating more pages...`
      case 'complete':
        return 'Saving documentation...'
      case 'error':
        return 'Error occurred'
      default:
        return progress.message || 'Generating documentation...'
    }
  }

  // Fetch pages on mount
  useEffect(() => {
    fetchPages()
  }, [repoId])

  // Poll while generating
  useEffect(() => {
    if (repo.doc_status === 'GENERATING') {
      setIsGenerating(true)
      // Set bundle id from repo if we don't have one
      if (repo.doc_bundle_id && !currentBundleId) {
        setCurrentBundleId(repo.doc_bundle_id)
      }
      const interval = setInterval(() => {
        fetchPages()
        // Also fetch bundle progress
        if (repo.doc_bundle_id) {
          fetchBundleProgress(repo.doc_bundle_id)
        }
      }, 2000)
      return () => clearInterval(interval)
    } else {
      setIsGenerating(false)
      setDocGenProgress(null)
      setCurrentBundleId(null)
    }
  }, [repo.doc_status, repo.doc_bundle_id])

  const fetchPages = async () => {
    try {
      const response = await fetch(
        `/api/projects/${projectId}/repos/${repoId}/docs/pages`
      )
      if (response.ok) {
        const data = await response.json()
        setBundle(data.bundle)
        setPages(data.pages)
        setIsLoading(false)

        // Check if generating completed
        if (data.bundle?.status !== 'GENERATING' && isGenerating) {
          setIsGenerating(false)
          toast({
            title: 'Documentation Generated',
            description: `Generated ${data.pages.length} documentation pages.`,
          })
        }
      }
    } catch (error) {
      console.error('Failed to fetch pages:', error)
      setIsLoading(false)
    }
  }

  const fetchBundleProgress = async (bundleId: string) => {
    try {
      const response = await fetch(
        `/api/projects/${projectId}/repos/${repoId}/docs/bundles/${bundleId}`
      )
      if (response.ok) {
        const bundleData = await response.json()
        if (bundleData.progress_json) {
          setDocGenProgress(bundleData.progress_json)
        }
      }
    } catch (error) {
      console.error('Failed to fetch bundle progress:', error)
    }
  }

  const handleCancelDocs = async () => {
    setIsCancelling(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/repos/${repoId}/docs/cancel`,
        { method: 'POST' }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel documentation generation')
      }

      // Clear local state
      setIsGenerating(false)
      setDocGenProgress(null)
      setCurrentBundleId(null)

      toast({
        title: 'Generation Cancelled',
        description: 'Documentation generation has been stopped.',
      })

      router.refresh()
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to cancel',
        variant: 'destructive',
      })
    } finally {
      setIsCancelling(false)
    }
  }

  const handleGenerate = async (force = false) => {
    setIsGenerating(true)
    setDocGenProgress(null)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/repos/${repoId}/docs/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force }),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start generation')
      }

      if (data.skipped) {
        toast({
          title: 'Documentation Up to Date',
          description: 'No changes detected since last generation.',
        })
        setIsGenerating(false)
      } else {
        // Store bundle id for progress polling
        if (data.bundle_id) {
          setCurrentBundleId(data.bundle_id)
        }

        toast({
          title: 'Generation Started',
          description: 'Documentation generation is in progress...',
        })

        // Start polling for progress
        const pollProgress = async () => {
          if (!data.bundle_id) return

          try {
            const [pagesRes, bundleRes] = await Promise.all([
              fetch(`/api/projects/${projectId}/repos/${repoId}/docs/pages`),
              fetch(`/api/projects/${projectId}/repos/${repoId}/docs/bundles/${data.bundle_id}`),
            ])

            // Check bundle status from the direct bundle endpoint (source of truth)
            if (bundleRes.ok) {
              const bundleData = await bundleRes.json()

              // Update progress if available
              if (bundleData.progress_json) {
                setDocGenProgress(bundleData.progress_json)
              }

              // Check if completed - use bundle endpoint status as source of truth
              if (bundleData.status && bundleData.status !== 'GENERATING' && bundleData.status !== 'PENDING') {
                // Fetch final pages data
                if (pagesRes.ok) {
                  const pagesData = await pagesRes.json()
                  setBundle(pagesData.bundle)
                  setPages(pagesData.pages)
                }

                setIsGenerating(false)
                setDocGenProgress(null)
                setCurrentBundleId(null)
                router.refresh()

                if (bundleData.status === 'ERROR') {
                  toast({
                    title: 'Generation Failed',
                    description: bundleData.error || 'An error occurred while generating documentation.',
                    variant: 'destructive',
                  })
                } else {
                  // Refetch pages to get accurate count
                  const finalPagesRes = await fetch(`/api/projects/${projectId}/repos/${repoId}/docs/pages`)
                  if (finalPagesRes.ok) {
                    const finalPagesData = await finalPagesRes.json()
                    setBundle(finalPagesData.bundle)
                    setPages(finalPagesData.pages)
                    toast({
                      title: 'Documentation Ready',
                      description: `Generated ${finalPagesData.pages?.length || 0} documentation pages.`,
                    })
                  } else {
                    toast({
                      title: 'Documentation Ready',
                      description: 'Documentation generation completed.',
                    })
                  }
                }
                return
              }
            }

            // Update pages if available (for UI updates during generation)
            if (pagesRes.ok) {
              const pagesData = await pagesRes.json()
              setBundle(pagesData.bundle)
              setPages(pagesData.pages)
            }

            // Continue polling
            setTimeout(pollProgress, 2000)
          } catch (error) {
            console.error('Error polling progress:', error)
            setTimeout(pollProgress, 2000)
          }
        }

        pollProgress()
      }
    } catch (error) {
      console.error('Failed to generate:', error)
      toast({
        title: 'Generation Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
      setIsGenerating(false)
      setDocGenProgress(null)
    }
  }

  const handleMarkReviewed = async () => {
    if (!bundle) return

    try {
      const response = await fetch(
        `/api/projects/${projectId}/repos/${repoId}/docs/mark-reviewed`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bundleId: bundle.id,
            clearAllReviewFlags: true,
            copyToDocuments: true,
          }),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to mark as reviewed')
      }

      const total = (data.documents_created || 0) + (data.documents_updated || 0)
      let description = 'Documentation has been marked as reviewed.'
      if (total > 0) {
        const parts = []
        if (data.documents_created > 0) parts.push(`${data.documents_created} created`)
        if (data.documents_updated > 0) parts.push(`${data.documents_updated} updated`)
        description = `Documentation marked as reviewed. ${parts.join(', ')} in project documentation.`
      }
      toast({
        title: 'Marked as Reviewed',
        description,
      })

      fetchPages()
      router.refresh()
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }

  const handleSyncToDocuments = async () => {
    if (!bundle) return

    try {
      const response = await fetch(
        `/api/projects/${projectId}/repos/${repoId}/docs/mark-reviewed`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bundleId: bundle.id,
            clearAllReviewFlags: false,
            copyToDocuments: true,
          }),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to sync to documentation')
      }

      const total = (data.documents_created || 0) + (data.documents_updated || 0)
      let description = 'Documentation is already synced.'
      if (total > 0) {
        const parts = []
        if (data.documents_created > 0) parts.push(`${data.documents_created} created`)
        if (data.documents_updated > 0) parts.push(`${data.documents_updated} updated`)
        description = `${parts.join(', ')} in project documentation.`
      }
      toast({
        title: 'Synced to Documentation',
        description,
      })

      router.refresh()
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }

  // Filter pages
  const filteredPages = pages.filter(page => {
    const matchesSearch = searchQuery === '' ||
      page.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      page.slug.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = activeCategory === 'ALL' || page.category === activeCategory
    return matchesSearch && matchesCategory
  })

  // Group pages by category
  const pagesByCategory = filteredPages.reduce((acc, page) => {
    if (!acc[page.category]) {
      acc[page.category] = []
    }
    acc[page.category].push(page)
    return acc
  }, {} as Record<RepoDocCategory, PageSummary[]>)

  const getStatusBadge = () => {
    if (isGenerating) {
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Generating
        </Badge>
      )
    }

    switch (bundle?.status) {
      case 'READY':
        return (
          <Badge variant="default" className="gap-1 bg-green-600">
            <CheckCircle className="h-3 w-3" />
            Ready
          </Badge>
        )
      case 'NEEDS_REVIEW':
        return (
          <Badge variant="secondary" className="gap-1 bg-yellow-600">
            <AlertCircle className="h-3 w-3" />
            Needs Review
          </Badge>
        )
      case 'ERROR':
        return (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="h-3 w-3" />
            Error
          </Badge>
        )
      case 'PENDING':
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            Pending
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="gap-1">
            <FileText className="h-3 w-3" />
            Not Generated
          </Badge>
        )
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-80 border-r bg-muted/30 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Documentation</h2>
            {getStatusBadge()}
          </div>
          <p className="text-sm text-muted-foreground">
            {repo.owner}/{repo.name}
          </p>
        </div>

        {/* Actions */}
        <div className="p-4 border-b space-y-2">
          <Button
            onClick={() => handleGenerate(pages.length > 0)}
            disabled={isGenerating}
            className="w-full"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : pages.length > 0 ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Regenerate Docs
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generate Docs
              </>
            )}
          </Button>

          {/* Progress bar when generating */}
          {isGenerating && (
            <div className="space-y-2 bg-gray-50 dark:bg-gray-900/50 p-3 rounded-md border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-purple-600" />
                  {getDocStageLabel(docGenProgress)}
                </span>
                <div className="flex items-center gap-2">
                  {/* Time remaining estimate */}
                  {getTimeRemaining(docGenProgress) && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {getTimeRemaining(docGenProgress)}
                    </span>
                  )}
                  {docGenProgress?.pagesGenerated !== undefined && docGenProgress.pagesGenerated > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {docGenProgress.pagesGenerated} pages
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                    onClick={handleCancelDocs}
                    disabled={isCancelling}
                    title="Cancel generation"
                  >
                    {isCancelling ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <X className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              {/* Stale progress warning */}
              {isProgressStale(docGenProgress) && (
                <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 p-2 rounded">
                  <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                  <span>Progress appears stale. The process may have stopped.</span>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs text-amber-700 dark:text-amber-300 underline"
                    onClick={handleCancelDocs}
                  >
                    Cancel and retry
                  </Button>
                </div>
              )}
              {/* Show streaming page titles if available */}
              {docGenProgress?.streamingPages && docGenProgress.streamingPages.length > 0 && !isProgressStale(docGenProgress) && (
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  <span className="font-medium">Generating: </span>
                  <span className="text-purple-600 dark:text-purple-400">
                    {docGenProgress.streamingPages[docGenProgress.streamingPages.length - 1]}
                  </span>
                </div>
              )}
              {docGenProgress?.message && !docGenProgress?.streamingPages?.length && !isProgressStale(docGenProgress) && (
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {docGenProgress.message}
                </p>
              )}
              {/* Progress indicator - shows actual progress when estimated time is available */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  {docGenProgress?.estimatedTotalSeconds && docGenProgress?.elapsedSeconds ? (
                    <div
                      className="h-full bg-purple-500 rounded-full transition-all duration-500 ease-out"
                      style={{
                        width: `${Math.min(95, (docGenProgress.elapsedSeconds / docGenProgress.estimatedTotalSeconds) * 100)}%`
                      }}
                    />
                  ) : (
                    <div
                      className="h-full bg-purple-500 rounded-full animate-progress-indeterminate"
                      style={{ width: '30%' }}
                    />
                  )}
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap font-medium">
                  Round {docGenProgress?.round || 1}/{docGenProgress?.maxRounds || 2}
                </span>
              </div>
            </div>
          )}

          {bundle?.status === 'NEEDS_REVIEW' && !isGenerating && (
            <Button
              variant="outline"
              onClick={handleMarkReviewed}
              className="w-full"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Mark as Reviewed
            </Button>
          )}

          {bundle?.status === 'READY' && pages.length > 0 && !isGenerating && (
            <Button
              variant="outline"
              onClick={handleSyncToDocuments}
              className="w-full"
            >
              <FileText className="h-4 w-4 mr-2" />
              Sync to Documentation
            </Button>
          )}
        </div>

        {/* Search */}
        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search pages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Category Filter */}
        <div className="p-2 border-b">
          <div className="flex flex-wrap gap-1">
            <Button
              variant={activeCategory === 'ALL' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveCategory('ALL')}
            >
              All
            </Button>
            {(Object.keys(REPO_DOC_CATEGORY_LABELS) as RepoDocCategory[]).map(cat => (
              <Button
                key={cat}
                variant={activeCategory === cat ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveCategory(cat)}
                className="gap-1"
              >
                {categoryIcons[cat]}
                <span className="hidden sm:inline">{REPO_DOC_CATEGORY_LABELS[cat]}</span>
              </Button>
            ))}
          </div>
        </div>

        {/* Page List */}
        <div className="flex-1 overflow-y-auto">
          {pages.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No documentation yet</p>
              <p className="text-sm mt-1">
                Click &quot;Generate Docs&quot; to create documentation
              </p>
            </div>
          ) : filteredPages.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              No pages match your search
            </div>
          ) : (
            (Object.entries(pagesByCategory) as [RepoDocCategory, PageSummary[]][]).map(([category, categoryPages]) => (
              <div key={category} className="border-b last:border-b-0">
                <div className="px-4 py-2 bg-muted/50 flex items-center gap-2">
                  {categoryIcons[category]}
                  <span className="font-medium text-sm">
                    {REPO_DOC_CATEGORY_LABELS[category]}
                  </span>
                  <Badge variant="outline" className="ml-auto text-xs">
                    {categoryPages.length}
                  </Badge>
                </div>
                {categoryPages.map(page => (
                  <button
                    key={page.id}
                    onClick={() => setSelectedPageId(page.id)}
                    className={`w-full px-4 py-2 text-left hover:bg-muted/50 flex items-center gap-2 ${
                      selectedPageId === page.id ? 'bg-muted' : ''
                    }`}
                  >
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    <span className="flex-1 truncate text-sm">{page.title}</span>
                    {page.needs_review && (
                      <Badge variant="outline" className="text-xs bg-yellow-500/10">
                        Review
                      </Badge>
                    )}
                    {page.user_edited && (
                      <Badge variant="outline" className="text-xs bg-blue-500/10">
                        Edited
                      </Badge>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Version Info */}
        {bundle && (
          <div className="p-4 border-t text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <History className="h-3 w-3" />
              <span>Version {bundle.version}</span>
              {bundle.generated_at && (
                <span className="ml-auto">
                  {new Date(bundle.generated_at).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        {selectedPageId ? (
          <DocPageViewer
            projectId={projectId}
            repoId={repoId}
            repoOwner={repo.owner}
            repoName={repo.name}
            pageId={selectedPageId}
            onUpdate={fetchPages}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <FileText className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg">Select a page to view</p>
              <p className="text-sm mt-1">
                Choose a documentation page from the sidebar
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
