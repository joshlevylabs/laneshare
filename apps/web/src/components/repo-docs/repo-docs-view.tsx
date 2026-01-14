'use client'

import { useState, useEffect } from 'react'
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

  // Fetch pages on mount
  useEffect(() => {
    fetchPages()
  }, [repoId])

  // Poll while generating
  useEffect(() => {
    if (repo.doc_status === 'GENERATING') {
      setIsGenerating(true)
      const interval = setInterval(() => {
        fetchPages()
      }, 3000)
      return () => clearInterval(interval)
    } else {
      setIsGenerating(false)
    }
  }, [repo.doc_status])

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

  const handleGenerate = async (force = false) => {
    setIsGenerating(true)
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
        toast({
          title: 'Generation Started',
          description: 'Documentation generation is in progress...',
        })
      }
    } catch (error) {
      console.error('Failed to generate:', error)
      toast({
        title: 'Generation Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
      setIsGenerating(false)
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
          body: JSON.stringify({ bundleId: bundle.id, clearAllReviewFlags: true }),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to mark as reviewed')
      }

      toast({
        title: 'Marked as Reviewed',
        description: 'Documentation has been marked as reviewed.',
      })

      fetchPages()
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
            onClick={() => handleGenerate(false)}
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

          {bundle?.status === 'NEEDS_REVIEW' && (
            <Button
              variant="outline"
              onClick={handleMarkReviewed}
              className="w-full"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Mark as Reviewed
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
