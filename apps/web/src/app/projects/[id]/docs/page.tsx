import { createServerSupabaseClient } from '@/lib/supabase/server'
import { DocsViewer } from '@/components/docs/docs-viewer'

export default async function DocsPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { slug?: string }
}) {
  const supabase = createServerSupabaseClient()

  // Fetch all doc pages
  const { data: docs } = await supabase
    .from('doc_pages')
    .select('*')
    .eq('project_id', params.id)
    .order('category')
    .order('slug')

  // Fetch decision logs
  const { data: decisions } = await supabase
    .from('decision_logs')
    .select('*')
    .eq('project_id', params.id)
    .order('created_at', { ascending: false })

  // Get active doc
  const activeSlug = searchParams.slug || docs?.[0]?.slug
  const activeDoc = docs?.find((d) => d.slug === activeSlug)

  return (
    <DocsViewer
      projectId={params.id}
      docs={docs || []}
      decisions={decisions || []}
      activeDoc={activeDoc || null}
    />
  )
}
