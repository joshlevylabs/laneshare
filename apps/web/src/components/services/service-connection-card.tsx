'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { ConnectSupabaseDialog } from './connect-supabase-dialog'
import { ConnectVercelDialog } from './connect-vercel-dialog'
import {
  Loader2,
  RefreshCw,
  Unplug,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
} from 'lucide-react'
import type { ServiceType } from '@/lib/supabase/types'

interface ServiceConnection {
  id: string
  service: string
  display_name: string
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR'
  config_json: Record<string, unknown>
  last_synced_at: string | null
  last_sync_error: string | null
  created_at: string
  updated_at: string
}

interface ServiceConnectionCardProps {
  projectId: string
  service: ServiceType
  title: string
  description: string
  icon: React.ReactNode
  connection?: ServiceConnection
  assetCounts?: { total: number; by_type: Record<string, number> }
  isAdmin: boolean
}

export function ServiceConnectionCard({
  projectId,
  service,
  title,
  description,
  icon,
  connection,
  assetCounts,
  isAdmin,
}: ServiceConnectionCardProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [isSyncing, setIsSyncing] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)

  const handleSync = async () => {
    if (!connection) return

    setIsSyncing(true)

    try {
      const response = await fetch(`/api/projects/${projectId}/services/${service}/sync`, {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to start sync')
      }

      toast({
        title: 'Sync started',
        description: 'Asset discovery is running in the background.',
      })

      // Poll for completion
      setTimeout(() => {
        router.refresh()
        setIsSyncing(false)
      }, 3000)
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Sync failed',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
      setIsSyncing(false)
    }
  }

  const handleDisconnect = async () => {
    if (!connection) return
    if (!confirm('Are you sure you want to disconnect this service? All synced assets will be deleted.')) {
      return
    }

    setIsDisconnecting(true)

    try {
      const response = await fetch(`/api/projects/${projectId}/services/${service}/disconnect`, {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to disconnect')
      }

      toast({
        title: 'Disconnected',
        description: `${title} has been disconnected from this project.`,
      })

      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to disconnect',
      })
    } finally {
      setIsDisconnecting(false)
    }
  }

  const getStatusBadge = () => {
    if (!connection) {
      return (
        <Badge variant="outline" className="text-muted-foreground">
          Not connected
        </Badge>
      )
    }

    switch (connection.status) {
      case 'CONNECTED':
        return (
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Connected
          </Badge>
        )
      case 'ERROR':
        return (
          <Badge variant="destructive">
            <XCircle className="mr-1 h-3 w-3" />
            Error
          </Badge>
        )
      default:
        return (
          <Badge variant="secondary">
            <AlertCircle className="mr-1 h-3 w-3" />
            {connection.status}
          </Badge>
        )
    }
  }

  const formatAssetCounts = () => {
    if (!assetCounts || assetCounts.total === 0) return null

    const parts = Object.entries(assetCounts.by_type)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => {
        const label = type.replace(/_/g, ' ').replace('vercel project', 'project')
        return `${count} ${label}${count > 1 ? 's' : ''}`
      })

    return parts.slice(0, 3).join(', ') + (parts.length > 3 ? ` +${parts.length - 3} more` : '')
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-muted rounded-lg">{icon}</div>
            <div>
              <CardTitle className="text-lg">{title}</CardTitle>
              {connection && (
                <p className="text-sm text-muted-foreground">{connection.display_name}</p>
              )}
            </div>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!connection ? (
          <>
            <CardDescription>{description}</CardDescription>
            {isAdmin ? (
              service === 'supabase' ? (
                <ConnectSupabaseDialog projectId={projectId} />
              ) : (
                <ConnectVercelDialog projectId={projectId} />
              )
            ) : (
              <p className="text-sm text-muted-foreground">
                Only project maintainers can connect services.
              </p>
            )}
          </>
        ) : (
          <>
            {assetCounts && assetCounts.total > 0 && (
              <div className="text-sm">
                <p className="text-muted-foreground mb-1">Discovered assets:</p>
                <p className="font-medium">{formatAssetCounts()}</p>
              </div>
            )}

            {connection.last_synced_at && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                Last synced: {new Date(connection.last_synced_at).toLocaleString()}
              </div>
            )}

            {connection.last_sync_error && (
              <div className="p-3 bg-destructive/10 text-destructive rounded-md text-sm">
                <strong>Error:</strong> {connection.last_sync_error}
              </div>
            )}

            {isAdmin && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSync}
                  disabled={isSyncing}
                >
                  {isSyncing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Sync Now
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={isDisconnecting}
                  className="text-destructive hover:text-destructive"
                >
                  {isDisconnecting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Unplug className="mr-2 h-4 w-4" />
                  )}
                  Disconnect
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
