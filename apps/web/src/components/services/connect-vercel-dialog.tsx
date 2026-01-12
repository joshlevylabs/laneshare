'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
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
import { useToast } from '@/components/ui/use-toast'
import { Loader2, Plus, CheckCircle2, Cloud } from 'lucide-react'

interface ConnectVercelDialogProps {
  projectId: string
}

interface Team {
  id: string
  slug: string
  name: string
}

interface VercelProject {
  id: string
  name: string
}

export function ConnectVercelDialog({ projectId }: ConnectVercelDialogProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'token' | 'configure' | 'validating' | 'success'>('token')
  const [isLoading, setIsLoading] = useState(false)

  const [token, setToken] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [teams, setTeams] = useState<Team[]>([])
  const [projects, setProjects] = useState<VercelProject[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<string>('')
  const [selectedTeamSlug, setSelectedTeamSlug] = useState<string>('')
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([])

  const handleValidateToken = async () => {
    setIsLoading(true)

    try {
      const response = await fetch(`/api/projects/${projectId}/services/vercel/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Validation failed')
      }

      const data = await response.json()
      setTeams(data.teams || [])
      setProjects(data.projects || [])
      setStep('configure')
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Validation failed',
        description: error instanceof Error ? error.message : 'Invalid token',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleTeamChange = async (teamId: string) => {
    setSelectedTeamId(teamId)
    const team = teams.find((t) => t.id === teamId)
    setSelectedTeamSlug(team?.slug || '')
    setSelectedProjectIds([])

    if (teamId) {
      setIsLoading(true)
      try {
        const response = await fetch(`/api/projects/${projectId}/services/vercel/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, team_id: teamId }),
        })

        if (response.ok) {
          const data = await response.json()
          setProjects(data.projects || [])
        }
      } catch {
        // Ignore errors, keep existing projects
      } finally {
        setIsLoading(false)
      }
    }
  }

  const handleConnect = async () => {
    setIsLoading(true)
    setStep('validating')

    try {
      const response = await fetch(`/api/projects/${projectId}/services/vercel/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          display_name: displayName || selectedTeamSlug || 'Vercel',
          team_id: selectedTeamId || undefined,
          team_slug: selectedTeamSlug || undefined,
          project_ids: selectedProjectIds.length > 0 ? selectedProjectIds : undefined,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Connection failed')
      }

      setStep('success')

      toast({
        title: 'Connected successfully',
        description: 'Vercel is now connected. Starting initial sync...',
      })

      // Trigger initial sync
      await fetch(`/api/projects/${projectId}/services/vercel/sync`, {
        method: 'POST',
      })

      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Connection failed',
        description: error instanceof Error ? error.message : 'Could not connect',
      })
      setStep('configure')
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setOpen(false)
    setStep('token')
    setToken('')
    setDisplayName('')
    setTeams([])
    setProjects([])
    setSelectedTeamId('')
    setSelectedTeamSlug('')
    setSelectedProjectIds([])
  }

  const toggleProject = (projectId: string) => {
    setSelectedProjectIds((prev) =>
      prev.includes(projectId) ? prev.filter((id) => id !== projectId) : [...prev, projectId]
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Connect Vercel
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            Connect Vercel
          </DialogTitle>
          <DialogDescription>
            Connect your Vercel account to sync deployments, domains, and environment variables.
          </DialogDescription>
        </DialogHeader>

        {step === 'token' && (
          <>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="vercel-token">Vercel Access Token</Label>
                <Input
                  id="vercel-token"
                  type="password"
                  placeholder="Enter your Vercel access token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Create a token at{' '}
                  <a
                    href="https://vercel.com/account/tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    vercel.com/account/tokens
                  </a>
                  . Select "Full Access" scope for all features.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleValidateToken} disabled={token.length < 20 || isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Continue
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'configure' && (
          <>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="display-name">Display Name</Label>
                <Input
                  id="display-name"
                  placeholder="My Vercel Account"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>

              {teams.length > 0 && (
                <div className="space-y-2">
                  <Label>Team (optional)</Label>
                  <Select value={selectedTeamId} onValueChange={handleTeamChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Personal Account" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Personal Account</SelectItem>
                      {teams.map((team) => (
                        <SelectItem key={team.id} value={team.id}>
                          {team.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {projects.length > 0 && (
                <div className="space-y-2">
                  <Label>Projects (optional - leave empty for all)</Label>
                  <div className="max-h-48 overflow-y-auto border rounded-md p-3 space-y-2">
                    {projects.map((project) => (
                      <div key={project.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={project.id}
                          checked={selectedProjectIds.includes(project.id)}
                          onCheckedChange={() => toggleProject(project.id)}
                        />
                        <label
                          htmlFor={project.id}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                          {project.name}
                        </label>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {selectedProjectIds.length === 0
                      ? 'All projects will be synced'
                      : `${selectedProjectIds.length} project(s) selected`}
                  </p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('token')}>
                Back
              </Button>
              <Button onClick={handleConnect} disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Connect
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'validating' && (
          <div className="py-8 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">
              Connecting and syncing assets...
            </p>
          </div>
        )}

        {step === 'success' && (
          <div className="py-8 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-green-600" />
            <p className="mt-4 font-medium">Connected Successfully!</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Initial sync is running in the background.
            </p>
            <Button className="mt-4" onClick={handleClose}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
