'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { formatRelativeTime, DOCUMENT_CATEGORY_LABELS, type DocumentCategory, type ProjectRole } from '@laneshare/shared'
import { useToast } from '@/hooks/use-toast'
import {
  FileText,
  Plus,
  Search,
  Filter,
  Layers,
  Code,
  BookOpen,
  Wrench,
  Lightbulb,
  Users,
  MessageSquare,
  MoreVertical,
  ChevronRight,
  Trash2,
  X,
  CheckSquare,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface DocumentListItem {
  id: string
  project_id: string
  title: string
  slug: string
  category: DocumentCategory
  description?: string
  tags: string[]
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
}

interface DocumentsViewProps {
  projectId: string
  projectName: string
  documents: DocumentListItem[]
  initialCategory?: string
  initialSearch?: string
  userRole: ProjectRole
}

const CATEGORY_ICONS: Record<DocumentCategory, React.ElementType> = {
  architecture: Layers,
  api: Code,
  feature_guide: BookOpen,
  runbook: Wrench,
  decision: Lightbulb,
  onboarding: Users,
  meeting_notes: MessageSquare,
  other: FileText,
}

const CATEGORY_COLORS: Record<DocumentCategory, string> = {
  architecture: 'text-purple-600 bg-purple-50 dark:bg-purple-950/30',
  api: 'text-blue-600 bg-blue-50 dark:bg-blue-950/30',
  feature_guide: 'text-green-600 bg-green-50 dark:bg-green-950/30',
  runbook: 'text-orange-600 bg-orange-50 dark:bg-orange-950/30',
  decision: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30',
  onboarding: 'text-pink-600 bg-pink-50 dark:bg-pink-950/30',
  meeting_notes: 'text-gray-600 bg-gray-50 dark:bg-gray-950/30',
  other: 'text-slate-600 bg-slate-50 dark:bg-slate-950/30',
}

export function DocumentsView({
  projectId,
  projectName,
  documents,
  initialCategory,
  initialSearch,
  userRole,
}: DocumentsViewProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [search, setSearch] = useState(initialSearch || '')
  const [selectedCategory, setSelectedCategory] = useState<DocumentCategory | null>(
    (initialCategory as DocumentCategory) || null
  )

  // Selection mode state
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const canDelete = ['OWNER', 'MAINTAINER'].includes(userRole)

  // Group documents by category for sidebar
  const docsByCategory = documents.reduce((acc, doc) => {
    if (!acc[doc.category]) acc[doc.category] = []
    acc[doc.category].push(doc)
    return acc
  }, {} as Record<DocumentCategory, DocumentListItem[]>)

  // Filter documents
  const filteredDocs = documents.filter((doc) => {
    if (selectedCategory && doc.category !== selectedCategory) return false
    if (search) {
      const searchLower = search.toLowerCase()
      return (
        doc.title.toLowerCase().includes(searchLower) ||
        doc.description?.toLowerCase().includes(searchLower) ||
        doc.tags.some((t) => t.toLowerCase().includes(searchLower))
      )
    }
    return true
  })

  const handleCategoryClick = (category: DocumentCategory | null) => {
    setSelectedCategory(category)
    const params = new URLSearchParams()
    if (category) params.set('category', category)
    if (search) params.set('search', search)
    router.push(`/projects/${projectId}/documents${params.toString() ? `?${params.toString()}` : ''}`)
  }

  const handleSearch = (value: string) => {
    setSearch(value)
    const params = new URLSearchParams()
    if (selectedCategory) params.set('category', selectedCategory)
    if (value) params.set('search', value)
    router.push(`/projects/${projectId}/documents${params.toString() ? `?${params.toString()}` : ''}`)
  }

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  const selectAll = () => {
    setSelectedIds(new Set(filteredDocs.map(d => d.id)))
  }

  const clearSelection = () => {
    setSelectedIds(new Set())
    setSelectionMode(false)
  }

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/documents`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete documents')
      }

      toast({
        title: 'Documents Deleted',
        description: `Successfully deleted ${data.deleted} document${data.deleted !== 1 ? 's' : ''}.`,
      })

      setSelectedIds(new Set())
      setSelectionMode(false)
      setShowDeleteDialog(false)
      router.refresh()
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete documents',
        variant: 'destructive',
      })
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="flex h-[calc(100vh-10rem)]">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 border-r pr-4 space-y-4 overflow-y-auto">
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-muted-foreground px-2">Categories</h3>
          <button
            onClick={() => handleCategoryClick(null)}
            className={cn(
              'w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors',
              !selectedCategory ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
            )}
          >
            <FileText className="h-4 w-4" />
            All Documents
            <span className="ml-auto text-xs">{documents.length}</span>
          </button>

          {(Object.keys(DOCUMENT_CATEGORY_LABELS) as DocumentCategory[]).map((category) => {
            const Icon = CATEGORY_ICONS[category]
            const count = docsByCategory[category]?.length || 0

            return (
              <button
                key={category}
                onClick={() => handleCategoryClick(category)}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors',
                  selectedCategory === category
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                )}
              >
                <Icon className="h-4 w-4" />
                {DOCUMENT_CATEGORY_LABELS[category]}
                <span className="ml-auto text-xs">{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 pl-6 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileText className="h-6 w-6" />
              Documentation
            </h1>
            <p className="text-muted-foreground">
              {selectedCategory
                ? DOCUMENT_CATEGORY_LABELS[selectedCategory]
                : 'All documents'}{' '}
              for {projectName}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canDelete && documents.length > 0 && (
              selectionMode ? (
                <>
                  <Button variant="ghost" size="sm" onClick={selectAll}>
                    <CheckSquare className="h-4 w-4 mr-2" />
                    Select All ({filteredDocs.length})
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearSelection}>
                    <X className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                  {selectedIds.size > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setShowDeleteDialog(true)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete ({selectedIds.size})
                    </Button>
                  )}
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectionMode(true)}
                >
                  <CheckSquare className="h-4 w-4 mr-2" />
                  Select
                </Button>
              )
            )}
            <Link href={`/projects/${projectId}/documents/new`}>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                New Document
              </Button>
            </Link>
          </div>
        </div>

        {/* Search */}
        <div className="flex gap-2 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search documents..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {selectedCategory && (
            <Button variant="ghost" onClick={() => handleCategoryClick(null)}>
              <Filter className="h-4 w-4 mr-2" />
              Clear filter
            </Button>
          )}
        </div>

        {/* Document list */}
        {filteredDocs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No documents yet</h3>
              <p className="text-muted-foreground text-center max-w-sm mb-4">
                {search || selectedCategory
                  ? 'No documents match your search criteria.'
                  : 'Create your first document using the Document Builder.'}
              </p>
              <Link href={`/projects/${projectId}/documents/new`}>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Document
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredDocs.map((doc) => {
              const Icon = CATEGORY_ICONS[doc.category]
              const colorClass = CATEGORY_COLORS[doc.category]
              const isSelected = selectedIds.has(doc.id)

              const cardContent = (
                <Card className={cn(
                  "hover:border-primary/50 transition-colors cursor-pointer",
                  isSelected && "border-primary bg-primary/5"
                )}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        {selectionMode && (
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelection(doc.id)}
                            className="mt-1"
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                        <div
                          className={cn(
                            'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
                            colorClass
                          )}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium truncate">{doc.title}</h3>
                            <Badge variant="secondary" className="text-xs">
                              {DOCUMENT_CATEGORY_LABELS[doc.category]}
                            </Badge>
                          </div>
                          {doc.description && (
                            <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">
                              {doc.description}
                            </p>
                          )}
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                            <span>
                              Updated {formatRelativeTime(doc.updated_at)}
                            </span>
                            {doc.creator && (
                              <>
                                <span>•</span>
                                <span>
                                  by {doc.creator.full_name || doc.creator.email}
                                </span>
                              </>
                            )}
                          </div>
                          {doc.tags.length > 0 && (
                            <div className="flex gap-1 mt-2">
                              {doc.tags.slice(0, 3).map((tag) => (
                                <Badge key={tag} variant="outline" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                              {doc.tags.length > 3 && (
                                <span className="text-xs text-muted-foreground">
                                  +{doc.tags.length - 3}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    </div>
                  </CardContent>
                </Card>
              )

              if (selectionMode) {
                return (
                  <div
                    key={doc.id}
                    onClick={() => toggleSelection(doc.id)}
                    className="block"
                  >
                    {cardContent}
                  </div>
                )
              }

              return (
                <Link
                  key={doc.id}
                  href={`/projects/${projectId}/documents/${doc.id}`}
                  className="block"
                >
                  {cardContent}
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} Document{selectedIds.size !== 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The selected document{selectedIds.size !== 1 ? 's' : ''} will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
