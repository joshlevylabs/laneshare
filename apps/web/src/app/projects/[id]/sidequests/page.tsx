'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { SidequestList, SidequestCreateDialog } from '@/components/sidequests'
import { Loader2 } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import type { Sidequest } from '@laneshare/shared'

interface Repo {
  id: string
  owner: string
  name: string
  default_branch?: string
}

export default function SidequestsPage() {
  const router = useRouter()
  const params = useParams()
  const projectId = params.id as string
  const { toast } = useToast()

  const [sidequests, setSidequests] = useState<Sidequest[]>([])
  const [repos, setRepos] = useState<Repo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  // Fetch sidequests and repos
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sqResponse, repoResponse] = await Promise.all([
          fetch(`/api/projects/${projectId}/sidequests`),
          fetch(`/api/projects/${projectId}/repos`),
        ])

        if (!sqResponse.ok) throw new Error('Failed to fetch sidequests')
        if (!repoResponse.ok) throw new Error('Failed to fetch repos')

        const sqData = await sqResponse.json()
        const repoData = await repoResponse.json()

        setSidequests(sqData)
        setRepos(repoData)
      } catch (error) {
        console.error('Fetch error:', error)
        toast({ title: 'Error', description: 'Failed to load data', variant: 'destructive' })
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [projectId])

  const handleCreate = () => {
    if (repos.length === 0) {
      toast({ title: 'No repositories', description: 'Please connect at least one repository first', variant: 'destructive' })
      return
    }
    setCreateDialogOpen(true)
  }

  const handleCreated = (sidequest: Sidequest) => {
    // Navigate to the new sidequest
    router.push(`/projects/${projectId}/sidequests/${sidequest.id}`)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="container max-w-6xl py-6">
      <SidequestList
        sidequests={sidequests}
        projectId={projectId}
        onCreateNew={handleCreate}
      />

      <SidequestCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        projectId={projectId}
        repos={repos}
        onCreated={handleCreated}
      />
    </div>
  )
}
