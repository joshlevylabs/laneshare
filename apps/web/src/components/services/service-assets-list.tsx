'use client'

import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Loader2, Search, Table2, FileCode, Shield, FunctionSquare, HardDrive, Globe, Rocket, Key, Copy, Check } from 'lucide-react'
import type { ServiceType } from '@/lib/supabase/types'

interface Asset {
  id: string
  asset_type: string
  asset_key: string
  name: string
  data_json: Record<string, unknown>
  updated_at: string
}

interface ServiceAssetsListProps {
  projectId: string
  service: ServiceType
  connectionId: string
}

const SUPABASE_ASSET_TYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'table', label: 'Tables' },
  { value: 'policy', label: 'Policies' },
  { value: 'function', label: 'Functions' },
  { value: 'trigger', label: 'Triggers' },
  { value: 'bucket', label: 'Buckets' },
]

const VERCEL_ASSET_TYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'vercel_project', label: 'Projects' },
  { value: 'deployment', label: 'Deployments' },
  { value: 'domain', label: 'Domains' },
  { value: 'env_var', label: 'Env Variables' },
]

const ASSET_ICONS: Record<string, React.ReactNode> = {
  table: <Table2 className="h-4 w-4" />,
  policy: <Shield className="h-4 w-4" />,
  function: <FunctionSquare className="h-4 w-4" />,
  trigger: <FileCode className="h-4 w-4" />,
  bucket: <HardDrive className="h-4 w-4" />,
  vercel_project: <Rocket className="h-4 w-4" />,
  deployment: <Globe className="h-4 w-4" />,
  domain: <Globe className="h-4 w-4" />,
  env_var: <Key className="h-4 w-4" />,
}

export function ServiceAssetsList({ projectId, service, connectionId }: ServiceAssetsListProps) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [assetType, setAssetType] = useState('all')
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [copied, setCopied] = useState(false)

  const assetTypes = service === 'supabase' ? SUPABASE_ASSET_TYPES : VERCEL_ASSET_TYPES

  useEffect(() => {
    const fetchAssets = async () => {
      setIsLoading(true)

      try {
        const params = new URLSearchParams({
          service,
          connection_id: connectionId,
        })

        if (assetType && assetType !== 'all') {
          params.set('type', assetType)
        }

        if (searchQuery) {
          params.set('q', searchQuery)
        }

        const response = await fetch(`/api/projects/${projectId}/services/assets?${params}`)

        if (response.ok) {
          const data = await response.json()
          setAssets(data.assets || [])
        }
      } catch (error) {
        console.error('Failed to fetch assets:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchAssets()
  }, [projectId, service, connectionId, assetType, searchQuery])

  const handleCopyJson = async () => {
    if (selectedAsset) {
      await navigator.clipboard.writeText(JSON.stringify(selectedAsset.data_json, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const formatAssetType = (type: string) => {
    return type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search assets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={assetType} onValueChange={setAssetType}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {assetTypes.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="py-8 text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">Loading assets...</p>
        </div>
      ) : assets.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground">
          {searchQuery || assetType !== 'all'
            ? 'No assets match your filters'
            : 'No assets discovered yet. Try running a sync.'}
        </div>
      ) : (
        <div className="border rounded-md">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">Type</th>
                <th className="text-left p-3 font-medium">Name</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">Key</th>
                <th className="text-left p-3 font-medium hidden lg:table-cell">Updated</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr
                  key={asset.id}
                  className="border-b last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => setSelectedAsset(asset)}
                >
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {ASSET_ICONS[asset.asset_type] || <FileCode className="h-4 w-4" />}
                      <Badge variant="outline" className="font-normal">
                        {formatAssetType(asset.asset_type)}
                      </Badge>
                    </div>
                  </td>
                  <td className="p-3 font-medium">{asset.name}</td>
                  <td className="p-3 hidden md:table-cell">
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      {asset.asset_key.length > 40
                        ? `${asset.asset_key.slice(0, 40)}...`
                        : asset.asset_key}
                    </code>
                  </td>
                  <td className="p-3 hidden lg:table-cell text-muted-foreground">
                    {new Date(asset.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={!!selectedAsset} onOpenChange={(open) => !open && setSelectedAsset(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selectedAsset && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-2">
                  {ASSET_ICONS[selectedAsset.asset_type] || <FileCode className="h-5 w-5" />}
                  <SheetTitle>{selectedAsset.name}</SheetTitle>
                </div>
                <SheetDescription>
                  <Badge variant="outline">{formatAssetType(selectedAsset.asset_type)}</Badge>
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-4">
                <div>
                  <h4 className="text-sm font-medium mb-2">Asset Key</h4>
                  <code className="text-xs bg-muted px-2 py-1 rounded block break-all">
                    {selectedAsset.asset_key}
                  </code>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium">Metadata</h4>
                    <Button variant="ghost" size="sm" onClick={handleCopyJson}>
                      {copied ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <pre className="text-xs bg-muted p-3 rounded overflow-x-auto max-h-96">
                    {JSON.stringify(selectedAsset.data_json, null, 2)}
                  </pre>
                </div>

                <div className="text-xs text-muted-foreground">
                  Last updated: {new Date(selectedAsset.updated_at).toLocaleString()}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
