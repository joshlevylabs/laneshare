'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@laneshare/shared'
import {
  FileText,
  Folder,
  Plus,
  Edit,
  Save,
  X,
  Loader2,
  ChevronRight,
  Lightbulb,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface DocPage {
  id: string
  slug: string
  title: string
  markdown: string
  category: 'architecture' | 'features' | 'decisions' | 'status'
  updated_at: string
}

interface Decision {
  id: string
  title: string
  context: string
  decision: string
  consequences: string | null
  created_at: string
}

interface DocsViewerProps {
  projectId: string
  docs: DocPage[]
  decisions: Decision[]
  activeDoc: DocPage | null
}

const categoryLabels = {
  architecture: 'Architecture',
  features: 'Features',
  decisions: 'Decisions',
  status: 'Status',
}

const categoryIcons = {
  architecture: Folder,
  features: FileText,
  decisions: Lightbulb,
  status: ChevronRight,
}

export function DocsViewer({ projectId, docs, decisions, activeDoc }: DocsViewerProps) {
  const { toast } = useToast()
  const router = useRouter()

  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  const [newDocTitle, setNewDocTitle] = useState('')
  const [newDocSlug, setNewDocSlug] = useState('')
  const [newDocCategory, setNewDocCategory] = useState<DocPage['category']>('features')
  const [isCreating, setIsCreating] = useState(false)

  // Group docs by category
  const docsByCategory = docs.reduce((acc, doc) => {
    if (!acc[doc.category]) acc[doc.category] = []
    acc[doc.category].push(doc)
    return acc
  }, {} as Record<string, DocPage[]>)

  const startEditing = () => {
    if (activeDoc) {
      setEditContent(activeDoc.markdown)
      setIsEditing(true)
    }
  }

  const cancelEditing = () => {
    setIsEditing(false)
    setEditContent('')
  }

  const saveEdit = async () => {
    if (!activeDoc) return

    setIsSaving(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/docs/${activeDoc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: editContent }),
      })

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

  const createDoc = async () => {
    if (!newDocTitle || !newDocSlug) return

    setIsCreating(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newDocTitle,
          slug: `${newDocCategory}/${newDocSlug}`,
          category: newDocCategory,
          markdown: `# ${newDocTitle}\n\n*Add your content here*`,
        }),
      })

      if (!response.ok) throw new Error('Failed to create')

      const doc = await response.json()

      toast({
        title: 'Created',
        description: 'New document has been created.',
      })

      setShowCreateDialog(false)
      setNewDocTitle('')
      setNewDocSlug('')
      router.push(`/projects/${projectId}/docs?slug=${doc.slug}`)
      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to create document.',
      })
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-10rem)]">
      {/* Sidebar */}
      <Card className="w-64 flex-shrink-0 overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Documentation</CardTitle>
            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Plus className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Document</DialogTitle>
                  <DialogDescription>Add a new documentation page.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select
                      value={newDocCategory}
                      onValueChange={(v) => setNewDocCategory(v as DocPage['category'])}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="architecture">Architecture</SelectItem>
                        <SelectItem value="features">Features</SelectItem>
                        <SelectItem value="decisions">Decisions</SelectItem>
                        <SelectItem value="status">Status</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Title</Label>
                    <Input
                      placeholder="Document Title"
                      value={newDocTitle}
                      onChange={(e) => setNewDocTitle(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Slug</Label>
                    <Input
                      placeholder="document-slug"
                      value={newDocSlug}
                      onChange={(e) => setNewDocSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Full path: {newDocCategory}/{newDocSlug || 'document-slug'}
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={createDoc} disabled={isCreating || !newDocTitle || !newDocSlug}>
                    {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="overflow-y-auto h-[calc(100%-4rem)] space-y-4">
          {Object.entries(categoryLabels).map(([category, label]) => {
            const Icon = categoryIcons[category as keyof typeof categoryIcons]
            const categoryDocs = docsByCategory[category] || []

            return (
              <div key={category}>
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
                  <Icon className="h-4 w-4" />
                  {label}
                </div>
                <div className="space-y-1 pl-6">
                  {categoryDocs.map((doc) => (
                    <Link
                      key={doc.id}
                      href={`/projects/${projectId}/docs?slug=${doc.slug}`}
                      className={cn(
                        'block text-sm py-1 px-2 rounded-md transition-colors',
                        activeDoc?.id === doc.id
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted'
                      )}
                    >
                      {doc.title}
                    </Link>
                  ))}
                  {categoryDocs.length === 0 && (
                    <p className="text-xs text-muted-foreground py-1">No documents</p>
                  )}
                </div>
              </div>
            )
          })}

          {/* Decision Log */}
          {decisions.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
                <Lightbulb className="h-4 w-4" />
                Recent Decisions
              </div>
              <div className="space-y-1 pl-6">
                {decisions.slice(0, 5).map((decision) => (
                  <div
                    key={decision.id}
                    className="text-xs py-1 px-2 bg-muted/50 rounded-md"
                  >
                    <p className="font-medium truncate">{decision.title}</p>
                    <p className="text-muted-foreground">
                      {formatRelativeTime(decision.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Content */}
      <Card className="flex-1 overflow-hidden">
        {activeDoc ? (
          <>
            <CardHeader className="pb-2 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <Badge variant="outline" className="mb-2">
                    {categoryLabels[activeDoc.category]}
                  </Badge>
                  <CardTitle>{activeDoc.title}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Last updated {formatRelativeTime(activeDoc.updated_at)}
                  </p>
                </div>
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={cancelEditing}>
                      <X className="h-4 w-4 mr-1" />
                      Cancel
                    </Button>
                    <Button size="sm" onClick={saveEdit} disabled={isSaving}>
                      {isSaving ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-1" />
                      )}
                      Save
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={startEditing}>
                    <Edit className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="overflow-y-auto h-[calc(100%-6rem)] p-6">
              {isEditing ? (
                <Textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="min-h-[500px] font-mono text-sm"
                />
              ) : (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {activeDoc.markdown}
                  </ReactMarkdown>
                </div>
              )}
            </CardContent>
          </>
        ) : (
          <CardContent className="flex flex-col items-center justify-center h-full">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No document selected</h3>
            <p className="text-muted-foreground">
              Select a document from the sidebar or create a new one.
            </p>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
