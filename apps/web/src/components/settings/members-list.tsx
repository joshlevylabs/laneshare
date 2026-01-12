'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { Loader2, Trash2 } from 'lucide-react'

interface Member {
  id: string
  user_id: string
  role: 'OWNER' | 'MAINTAINER' | 'MEMBER'
  email: string
  full_name: string | null
  created_at: string
}

interface MembersListProps {
  projectId: string
  members: Member[]
  currentUserId: string
  isAdmin: boolean
}

export function MembersList({
  projectId,
  members,
  currentUserId,
  isAdmin,
}: MembersListProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [updatingMember, setUpdatingMember] = useState<string | null>(null)
  const [removingMember, setRemovingMember] = useState<string | null>(null)

  const updateRole = async (memberId: string, role: string) => {
    setUpdatingMember(memberId)

    try {
      const response = await fetch(`/api/projects/${projectId}/members/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to update role')
      }

      toast({
        title: 'Role updated',
        description: 'Member role has been changed.',
      })

      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update role',
      })
    } finally {
      setUpdatingMember(null)
    }
  }

  const removeMember = async (memberId: string) => {
    setRemovingMember(memberId)

    try {
      const response = await fetch(`/api/projects/${projectId}/members/${memberId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to remove member')
      }

      toast({
        title: 'Member removed',
        description: 'The member has been removed from the project.',
      })

      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to remove member',
      })
    } finally {
      setRemovingMember(null)
    }
  }

  return (
    <div className="space-y-4">
      {members.map((member) => {
        const isCurrentUser = member.user_id === currentUserId
        const isOwner = member.role === 'OWNER'
        const canModify = isAdmin && !isOwner && !isCurrentUser

        return (
          <div
            key={member.id}
            className="flex items-center justify-between py-3 border-b last:border-0"
          >
            <div className="flex items-center gap-3">
              <Avatar>
                <AvatarFallback>
                  {(member.full_name || member.email)[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{member.full_name || member.email}</p>
                  {isCurrentUser && (
                    <Badge variant="secondary" className="text-xs">
                      You
                    </Badge>
                  )}
                </div>
                {member.full_name && (
                  <p className="text-sm text-muted-foreground">{member.email}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Joined {formatRelativeTime(member.created_at)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {canModify ? (
                <Select
                  value={member.role}
                  onValueChange={(value) => updateRole(member.id, value)}
                  disabled={updatingMember === member.id}
                >
                  <SelectTrigger className="w-32">
                    {updatingMember === member.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <SelectValue />
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MAINTAINER">Maintainer</SelectItem>
                    <SelectItem value="MEMBER">Member</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="outline">{member.role}</Badge>
              )}

              {canModify && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={removingMember === member.id}
                    >
                      {removingMember === member.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove Member</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to remove {member.full_name || member.email} from
                        this project? They will lose access to all project resources.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => removeMember(member.id)}>
                        Remove
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
