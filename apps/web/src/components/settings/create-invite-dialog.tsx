'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
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
import { Loader2, Link2, Copy, Check } from 'lucide-react'

interface CreateInviteDialogProps {
  projectId: string
}

export function CreateInviteDialog({ projectId }: CreateInviteDialogProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [role, setRole] = useState('MEMBER')
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleCreate = async () => {
    setIsLoading(true)

    try {
      const response = await fetch(`/api/projects/${projectId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create invitation')
      }

      const invitation = await response.json()
      const url = `${window.location.origin}/invite/${invitation.token}`
      setInviteUrl(url)

      toast({
        title: 'Invitation created',
        description: 'Share the link to invite team members.',
      })

      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create invitation',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleCopy = async () => {
    if (inviteUrl) {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleClose = () => {
    setOpen(false)
    setInviteUrl(null)
    setRole('MEMBER')
    setCopied(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => v ? setOpen(true) : handleClose()}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Link2 className="mr-2 h-4 w-4" />
          Create Invite Link
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Invitation Link</DialogTitle>
          <DialogDescription>
            Generate a shareable link to invite team members. Links expire after 7 days.
          </DialogDescription>
        </DialogHeader>

        {!inviteUrl ? (
          <>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MAINTAINER">
                      <div>
                        <p className="font-medium">Maintainer</p>
                        <p className="text-xs text-muted-foreground">
                          Can manage repos, tasks, and members
                        </p>
                      </div>
                    </SelectItem>
                    <SelectItem value="MEMBER">
                      <div>
                        <p className="font-medium">Member</p>
                        <p className="text-xs text-muted-foreground">
                          Can view and edit tasks and docs
                        </p>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Link
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Invitation Link</Label>
                <div className="flex gap-2">
                  <Input value={inviteUrl} readOnly className="font-mono text-sm" />
                  <Button variant="outline" size="icon" onClick={handleCopy}>
                    {copied ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  This link will expire in 7 days. Anyone with this link can join as {role.toLowerCase()}.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
