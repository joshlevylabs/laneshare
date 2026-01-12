'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/use-toast'
import { formatRelativeTime } from '@laneshare/shared'
import { Loader2, Trash2, Copy, Check, Link2 } from 'lucide-react'

interface Invitation {
  id: string
  token: string
  role: 'MAINTAINER' | 'MEMBER'
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'
  expires_at: string
  created_at: string
  profiles: {
    email: string
    full_name: string | null
  }
}

interface InvitationsListProps {
  projectId: string
  invitations: Invitation[]
}

export function InvitationsList({ projectId, invitations }: InvitationsListProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const handleRevoke = async (inviteId: string) => {
    setRevokingId(inviteId)

    try {
      const response = await fetch(
        `/api/projects/${projectId}/invitations/${inviteId}`,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        throw new Error('Failed to revoke invitation')
      }

      toast({
        title: 'Invitation revoked',
        description: 'The invitation link is no longer valid.',
      })

      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to revoke invitation',
      })
    } finally {
      setRevokingId(null)
    }
  }

  const handleCopy = async (token: string, id: string) => {
    const url = `${window.location.origin}/invite/${token}`
    await navigator.clipboard.writeText(url)
    setCopiedId(id)
    toast({
      title: 'Link copied',
      description: 'Invitation link copied to clipboard.',
    })
    setTimeout(() => setCopiedId(null), 2000)
  }

  const getStatusBadge = (invitation: Invitation) => {
    const isExpired = new Date(invitation.expires_at) < new Date()

    if (invitation.status === 'ACCEPTED') {
      return <Badge variant="default">Accepted</Badge>
    }
    if (invitation.status === 'REVOKED') {
      return <Badge variant="destructive">Revoked</Badge>
    }
    if (isExpired) {
      return <Badge variant="secondary">Expired</Badge>
    }
    return <Badge variant="outline">Pending</Badge>
  }

  if (invitations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No invitations yet. Create an invite link to share with team members.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {invitations.map((invitation) => {
        const isActive = invitation.status === 'PENDING' &&
                         new Date(invitation.expires_at) > new Date()

        return (
          <div
            key={invitation.id}
            className="flex items-center justify-between py-3 border-b last:border-0"
          >
            <div className="flex items-center gap-3">
              <Link2 className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{invitation.role}</Badge>
                  {getStatusBadge(invitation)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Created by {invitation.profiles.full_name || invitation.profiles.email}{' '}
                  {formatRelativeTime(invitation.created_at)}
                </p>
                {isActive && (
                  <p className="text-xs text-muted-foreground">
                    Expires {formatRelativeTime(invitation.expires_at)}
                  </p>
                )}
              </div>
            </div>

            {isActive && (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleCopy(invitation.token, invitation.id)}
                >
                  {copiedId === invitation.id ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={revokingId === invitation.id}
                    >
                      {revokingId === invitation.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revoke Invitation</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to revoke this invitation?
                        Anyone with this link will no longer be able to join.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleRevoke(invitation.id)}>
                        Revoke
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
