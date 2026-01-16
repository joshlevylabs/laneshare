'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Sparkles } from 'lucide-react'

type AIModel = 'gpt-4o' | 'gpt-4o-mini' | 'gpt-5' | 'o1' | 'o1-mini'

interface ProjectSettings {
  ai_model?: AIModel
  [key: string]: unknown
}

const AI_MODELS: { value: AIModel; label: string; description: string }[] = [
  { value: 'gpt-4o', label: 'GPT-4o', description: 'Fast and efficient' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini', description: 'Fastest, lower cost' },
  { value: 'gpt-5', label: 'GPT-5', description: 'Most capable (preview)' },
  { value: 'o1', label: 'o1', description: 'Advanced reasoning' },
  { value: 'o1-mini', label: 'o1-mini', description: 'Fast reasoning' },
]

interface ProjectSettingsFormProps {
  project: {
    id: string
    name: string
    description: string | null
    settings: ProjectSettings | null
  }
  isAdmin: boolean
}

export function ProjectSettingsForm({ project, isAdmin }: ProjectSettingsFormProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description || '')
  const [aiModel, setAiModel] = useState<AIModel>(project.settings?.ai_model || 'gpt-4o')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isAdmin) return

    setIsLoading(true)

    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description || null,
          settings: { ai_model: aiModel },
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to update project')
      }

      toast({
        title: 'Saved',
        description: 'Project settings have been updated.',
      })

      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update project',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Project Name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!isAdmin}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={!isAdmin}
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ai-model" className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          AI Model for PRD Planning
        </Label>
        <Select
          value={aiModel}
          onValueChange={(value) => setAiModel(value as AIModel)}
          disabled={!isAdmin}
        >
          <SelectTrigger id="ai-model">
            <SelectValue placeholder="Select AI model" />
          </SelectTrigger>
          <SelectContent>
            {AI_MODELS.map((model) => (
              <SelectItem key={model.value} value={model.value}>
                <div className="flex flex-col">
                  <span className="font-medium">{model.label}</span>
                  <span className="text-xs text-muted-foreground">{model.description}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          This model will be used for PRD planning and AI-assisted features.
        </p>
      </div>

      {isAdmin && (
        <Button type="submit" disabled={isLoading}>
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Changes
        </Button>
      )}
    </form>
  )
}
