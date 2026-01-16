import { createServerSupabaseClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ServiceConnectionCard } from '@/components/services/service-connection-card'
import { ServiceAssetsList } from '@/components/services/service-assets-list'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Database, Cloud, FileJson } from 'lucide-react'

export default async function ServicesPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Get project info
  const { data: project } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', params.id)
    .single()

  // Get current user's role
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user?.id || '')
    .single()

  const currentUserRole = membership?.role || 'MEMBER'
  const isAdmin = ['OWNER', 'MAINTAINER'].includes(currentUserRole)

  // Get all service connections
  const { data: connections } = await supabase
    .from('project_service_connections')
    .select(`
      id,
      service,
      display_name,
      status,
      config_json,
      last_synced_at,
      last_sync_error,
      created_at,
      updated_at
    `)
    .eq('project_id', params.id)
    .order('service')

  // Get asset counts for each connection
  const connectionAssets: Record<string, { total: number; by_type: Record<string, number> }> = {}

  for (const connection of connections || []) {
    const { data: assets } = await supabase
      .from('service_assets')
      .select('asset_type')
      .eq('connection_id', connection.id)

    if (assets) {
      const byType: Record<string, number> = {}
      for (const asset of assets) {
        byType[asset.asset_type] = (byType[asset.asset_type] || 0) + 1
      }
      connectionAssets[connection.id] = {
        total: assets.length,
        by_type: byType,
      }
    }
  }

  // Cast through unknown to handle DB null vs TS undefined mismatch
  type ServiceConnection = Parameters<typeof ServiceConnectionCard>[0]['connection']
  const supabaseConnection = connections?.find((c) => c.service === 'supabase') as unknown as ServiceConnection
  const vercelConnection = connections?.find((c) => c.service === 'vercel') as unknown as ServiceConnection
  const openApiConnections = (connections?.filter((c) => c.service === 'openapi') || []) as unknown as NonNullable<ServiceConnection>[]

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Connected Services</h1>
        <p className="text-muted-foreground">
          Connect external services to sync metadata and automatically update documentation
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <ServiceConnectionCard
          projectId={params.id}
          service="supabase"
          title="Supabase"
          description="Connect your Supabase project to sync database schema, RLS policies, functions, and storage buckets."
          icon={<Database className="h-6 w-6" />}
          connection={supabaseConnection}
          assetCounts={supabaseConnection ? connectionAssets[supabaseConnection.id] : undefined}
          isAdmin={isAdmin}
        />

        <ServiceConnectionCard
          projectId={params.id}
          service="vercel"
          title="Vercel"
          description="Connect your Vercel account to sync projects, deployments, domains, and environment variables."
          icon={<Cloud className="h-6 w-6" />}
          connection={vercelConnection}
          assetCounts={vercelConnection ? connectionAssets[vercelConnection.id] : undefined}
          isAdmin={isAdmin}
        />

        {/* OpenAPI - show existing connections */}
        {openApiConnections.map((connection) => (
          <ServiceConnectionCard
            key={connection.id}
            projectId={params.id}
            service="openapi"
            title={connection.display_name}
            description="OpenAPI/Swagger specification with endpoints, schemas, and authentication details."
            icon={<FileJson className="h-6 w-6" />}
            connection={connection}
            assetCounts={connectionAssets[connection.id]}
            isAdmin={isAdmin}
          />
        ))}

        {/* OpenAPI - add new */}
        <ServiceConnectionCard
          projectId={params.id}
          service="openapi"
          title="OpenAPI / Swagger"
          description="Connect an OpenAPI or Swagger spec URL to sync API endpoints, schemas, and authentication details."
          icon={<FileJson className="h-6 w-6" />}
          connection={undefined}
          isAdmin={isAdmin}
        />
      </div>

      {(supabaseConnection || vercelConnection || openApiConnections.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Service Inventory</CardTitle>
            <CardDescription>
              Browse discovered assets from connected services
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue={supabaseConnection ? 'supabase' : vercelConnection ? 'vercel' : openApiConnections[0]?.id}>
              <TabsList>
                {supabaseConnection && (
                  <TabsTrigger value="supabase" className="flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Supabase
                  </TabsTrigger>
                )}
                {vercelConnection && (
                  <TabsTrigger value="vercel" className="flex items-center gap-2">
                    <Cloud className="h-4 w-4" />
                    Vercel
                  </TabsTrigger>
                )}
                {openApiConnections.map((connection) => (
                  <TabsTrigger key={connection.id} value={connection.id} className="flex items-center gap-2">
                    <FileJson className="h-4 w-4" />
                    {connection.display_name}
                  </TabsTrigger>
                ))}
              </TabsList>

              {supabaseConnection && (
                <TabsContent value="supabase">
                  <ServiceAssetsList
                    projectId={params.id}
                    service="supabase"
                    connectionId={supabaseConnection.id}
                  />
                </TabsContent>
              )}

              {vercelConnection && (
                <TabsContent value="vercel">
                  <ServiceAssetsList
                    projectId={params.id}
                    service="vercel"
                    connectionId={vercelConnection.id}
                  />
                </TabsContent>
              )}

              {openApiConnections.map((connection) => (
                <TabsContent key={connection.id} value={connection.id}>
                  <ServiceAssetsList
                    projectId={params.id}
                    service="openapi"
                    connectionId={connection.id}
                  />
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
