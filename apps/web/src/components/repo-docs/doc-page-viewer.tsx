'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
  Edit,
  Save,
  X,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  FileCode,
  ExternalLink,
  Loader2,
} from 'lucide-react'
import type { RepoDocPage, DocEvidence } from '@laneshare/shared'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

interface DocPageViewerProps {
  projectId: string
  repoId: string
  pageId: string
  onUpdate?: () => void
}

interface PageWithNavigation {
  page: RepoDocPage
  navigation: {
    prev: { id: string; slug: string; title: string } | null
    next: { id: string; slug: string; title: string } | null
  }
}

export function DocPageViewer({ projectId, repoId, pageId, onUpdate }: DocPageViewerProps) {
  const { toast } = useToast()
  const [data, setData] = useState<PageWithNavigation | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editedMarkdown, setEditedMarkdown] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [evidenceOpen, setEvidenceOpen] = useState(false)

  useEffect(() => {
    fetchPage()
  }, [pageId])

  const fetchPage = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/repos/${repoId}/docs/pages/${pageId}`
      )
      if (response.ok) {
        const pageData = await response.json()
        setData(pageData)
        setEditedMarkdown(pageData.page.markdown)
      }
    } catch (error) {
      console.error('Failed to fetch page:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    if (!data) return

    setIsSaving(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/repos/${repoId}/docs/pages/${pageId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown: editedMarkdown }),
        }
      )

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to save')
      }

      toast({
        title: 'Page Saved',
        description: 'Your changes have been saved.',
      })

      setIsEditing(false)
      fetchPage()
      onUpdate?.()
    } catch (error) {
      toast({
        title: 'Save Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancelEdit = () => {
    setEditedMarkdown(data?.page.markdown || '')
    setIsEditing(false)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Page not found
      </div>
    )
  }

  const { page, navigation } = data
  const evidence = page.evidence_json as DocEvidence[]

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="outline">{page.category}</Badge>
          <span className="text-muted-foreground text-sm">{page.slug}</span>
          {page.needs_review && (
            <Badge variant="secondary" className="gap-1 bg-yellow-600">
              <AlertCircle className="h-3 w-3" />
              Needs Review
            </Badge>
          )}
          {page.user_edited && (
            <Badge variant="secondary" className="gap-1 bg-blue-600">
              <Edit className="h-3 w-3" />
              User Edited
            </Badge>
          )}
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{page.title}</h1>
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button variant="outline" onClick={handleCancelEdit} disabled={isSaving}>
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setIsEditing(true)}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      {isEditing ? (
        <div className="space-y-4">
          <Textarea
            value={editedMarkdown}
            onChange={(e) => setEditedMarkdown(e.target.value)}
            className="min-h-[500px] font-mono text-sm"
          />
          <div className="text-sm text-muted-foreground">
            Markdown supported. Changes will be tracked as user edits.
          </div>
        </div>
      ) : (
        <div className="prose prose-slate dark:prose-invert max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ node, className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '')
                const inline = !match && !className
                return !inline && match ? (
                  <SyntaxHighlighter
                    style={oneDark}
                    language={match[1]}
                    PreTag="div"
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                ) : (
                  <code className={className} {...props}>
                    {children}
                  </code>
                )
              },
            }}
          >
            {page.markdown}
          </ReactMarkdown>
        </div>
      )}

      {/* Evidence Section */}
      {evidence.length > 0 && !isEditing && (
        <Collapsible open={evidenceOpen} onOpenChange={setEvidenceOpen} className="mt-8">
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              <div className="flex items-center gap-2">
                <FileCode className="h-4 w-4" />
                Evidence ({evidence.length} sources)
              </div>
              <ChevronRight className={`h-4 w-4 transition-transform ${evidenceOpen ? 'rotate-90' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 space-y-4">
            {evidence.map((item, index) => (
              <Card key={index}>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm font-mono flex items-center gap-2">
                    <FileCode className="h-4 w-4" />
                    {item.file_path}
                  </CardTitle>
                </CardHeader>
                <CardContent className="py-3">
                  <p className="text-sm text-muted-foreground mb-2">{item.reason}</p>
                  <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
                    <code>{item.excerpt}</code>
                  </pre>
                </CardContent>
              </Card>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between mt-8 pt-8 border-t">
        {navigation.prev ? (
          <Button
            variant="ghost"
            onClick={() => {
              // Navigate would be handled by parent
              window.location.href = `?page=${navigation.prev!.id}`
            }}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            {navigation.prev.title}
          </Button>
        ) : (
          <div />
        )}
        {navigation.next && (
          <Button
            variant="ghost"
            onClick={() => {
              window.location.href = `?page=${navigation.next!.id}`
            }}
          >
            {navigation.next.title}
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        )}
      </div>

      {/* Metadata */}
      <div className="mt-8 pt-4 border-t text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>
            Created: {new Date(page.created_at).toLocaleString()}
          </span>
          <span>
            Updated: {new Date(page.updated_at).toLocaleString()}
          </span>
        </div>
        {page.user_edited_at && (
          <div className="mt-1">
            Last user edit: {new Date(page.user_edited_at).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  )
}
