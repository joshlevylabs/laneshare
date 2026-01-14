'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Zap } from 'lucide-react'

interface AcceptInviteCardProps {
  token: string
  projectName: string
  role: string
  isAuthenticated: boolean
}

export function AcceptInviteCard({
  token,
  projectName,
  role,
  isAuthenticated,
}: AcceptInviteCardProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)

  const handleAccept = async () => {
    setIsLoading(true)

    try {
      const response = await fetch(`/api/invitations/${token}`, {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to accept invitation')
      }

      const result = await response.json()

      toast({
        title: 'Welcome to the team!',
        description: `You've joined ${projectName} as ${role.toLowerCase()}.`,
      })

      router.push(`/projects/${result.projectId}/dashboard`)
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to accept invitation',
      })
      setIsLoading(false)
    }
  }

  const handleLogin = () => {
    // Store the invite token to process after login
    sessionStorage.setItem('pendingInvite', token)
    router.push('/login')
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="flex items-center justify-center gap-2 mb-4">
          <Zap className="h-8 w-8 text-primary" />
          <span className="text-2xl font-bold">LaneShare</span>
        </div>
        <CardTitle>You're Invited!</CardTitle>
        <CardDescription>
          You've been invited to join <strong>{projectName}</strong> as a{' '}
          <strong>{role.toLowerCase()}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAuthenticated ? (
          <Button className="w-full" onClick={handleAccept} disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Accept Invitation
          </Button>
        ) : (
          <>
            <p className="text-sm text-muted-foreground text-center">
              Sign in or create an account to join this project.
            </p>
            <Button className="w-full" onClick={handleLogin}>
              Sign In to Accept
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
