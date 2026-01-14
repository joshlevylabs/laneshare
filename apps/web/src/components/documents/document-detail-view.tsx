'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  formatRelativeTime,
  DOCUMENT_CATEGORY_LABELS,
  type DocumentCategory,
  type ProjectRole,
  type DocumentReferenceKind,
} from '@laneshare/shared'
import {
  ArrowLeft,
  Edit,
  Save,
  X,
  Loader2,
  MoreVertical,
  Trash2,
  FileText,
  Boxes,
  CheckSquare,
  Link2,
  ExternalLink,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface DocumentData {
  id: string
  project_id: string
  title: string
  slug: string
  category: DocumentCategory
  description?: string
  tags: string[]
  markdown: string
  created_by?: string
  created_at: string
  updated_by?: string
  updated_at: string
  creator?: {
    id: string
    email: string
    full_name?: string
    avatar_url?: string
  }
  updater?: {
    id: string
    email: string
    full_name?: string
    avatar_url?: string
  }
}

interface DocumentReference {
  id: string
  source_type: 'task' | 'system' | 'document'
  source_id: string
  kind: DocumentReferenceKind
  created_at: string
  source?: {
    id: string
    key?: string
    title?: string
    name?: string
    slug?: string
    status?: string
    type?: string
    category?: string
  }
}

interface DocumentDetailViewProps {
  projectId: string
  projectName: string
  document: DocumentData
  references: DocumentReference[]
  userRole: ProjectRole
  userId: string
}

export function DocumentDetailView({
  projectId,
  projectName,
  document,
  references,
  userRole,
  userId,
}: DocumentDetailViewProps) {
  const router = useRouter()
  const { toast } = useToast()

  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(document.markdown)
  const [editTitle, setEditTitle] = useState(document.title)
  const [isSaving, setIsSaving] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const isAdmin = ['OWNER', 'MAINTAINER'].includes(userRole)

  const startEditing = useCallback(() => {
    setEditContent(document.markdown)
    setEditTitle(document.title)
    setIsEditing(true)
  }, [document])

  const cancelEditing = useCallback(() => {
    setIsEditing(false)
    setEditContent(document.markdown)
    setEditTitle(document.title)
  }, [document])

  const saveEdit = async () => {
    setIsSaving(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/documents/${document.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: editTitle,
            markdown: editContent,
          }),
        }
      )

      if (!response.ok) throw new Error('Failed to save')

      toast({
        title: 'Saved',
        description: 'Document has been updated.',
      })

      setIsEditing(false)
      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to save document.',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/documents/${document.id}`,
        { method: 'DELETE' }
      )

      if (!response.ok) throw new Error('Failed to delete')

      toast({
        title: 'Deleted',
        description: 'Document has been deleted.',
      })

      router.push(`/projects/${projectId}/documents`)
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to delete document.',
      })
    } finally {
      setIsDeleting(false)
      setShowDeleteDialog(false)
    }
  }

  // Group references by type
  const taskRefs = references.filter((r) => r.source_type === 'task')
  const systemRefs = references.filter((r) => r.source_type === 'system')
  const docRefs = references.filter((r) => r.source_type === 'document')

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/projects/${projectId}/documents`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Documents
            </Button>
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <Button variant="ghost" onClick={cancelEditing} disabled={isSaving}>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button onClick={saveEdit} disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={startEditing}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
              {isAdmin && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => setShowDeleteDialog(true)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Document
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex gap-6">
        {/* Main content */}
        <Card className="flex-1">
          <CardHeader className="border-b">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {DOCUMENT_CATEGORY_LABELS[document.category]}
                  </Badge>
                  {document.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
                {isEditing ? (
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="text-2xl font-bold h-auto py-1"
                  />
                ) : (
                  <CardTitle className="text-2xl">{document.title}</CardTitle>
                )}
                {document.description && !isEditing && (
                  <p className="text-muted-foreground">{document.description}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground mt-4">
              <span>
                Last updated {formatRelativeTime(document.updated_at)}
                {document.updater && (
                  <> by {document.updater.full_name || document.updater.email}</>
                )}
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            {isEditing ? (
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="min-h-[500px] font-mono text-sm"
                placeholder="Write your document content in Markdown..."
              />
            ) : (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {document.markdown || '*No content yet*'}
                </ReactMarkdown>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sidebar */}
        <div className="w-72 space-y-4 flex-shrink-0">
          {/* Referenced by */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                Referenced By
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {references.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No references to this document yet.
                </p>
              ) : (
                <>
                  {taskRefs.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-1">
                        Tasks
                      </h4>
                      {taskRefs.map((ref) => (
                        <Link
                          key={ref.id}
                          href={`/projects/${projectId}/tasks?task=${ref.source_id}`}
                          className="flex items-center gap-2 py-1 text-sm hover:text-primary transition-colors"
                        >
                          <CheckSquare className="h-3.5 w-3.5" />
                          <span className="font-mono text-xs">
                            {ref.source?.key}
                          </span>
                          <span className="truncate">{ref.source?.title}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                  {systemRefs.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-1">
                        Systems
                      </h4>
                      {systemRefs.map((ref) => (
                        <Link
                          key={ref.id}
                          href={`/projects/${projectId}/systems/${ref.source_id}`}
                          className="flex items-center gap-2 py-1 text-sm hover:text-primary transition-colors"
                        >
                          <Boxes className="h-3.5 w-3.5" />
                          <span className="truncate">{ref.source?.name}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                  {docRefs.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-1">
                        Related Documents
                      </h4>
                      {docRefs.map((ref) => (
                        <Link
                          key={ref.id}
                          href={`/projects/${projectId}/documents/${ref.source_id}`}
                          className="flex items-center gap-2 py-1 text-sm hover:text-primary transition-colors"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          <span className="truncate">{ref.source?.title}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Document info */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Document Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Slug</span>
                <span className="font-mono text-xs">{document.slug}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{formatRelativeTime(document.created_at)}</span>
              </div>
              {document.creator && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Author</span>
                  <span>{document.creator.full_name || document.creator.email}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Document</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{document.title}"? This action
              cannot be undone and will remove all references to this document.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
