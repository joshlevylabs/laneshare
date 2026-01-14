import { createServerSupabaseClient } from '@/lib/supabase/server'
// Legacy auto-doc generation disabled - documents are now user-created via Document Builder
// import { runDocGeneration } from '@/lib/doc-generator'
import { NextResponse } from 'next/server'

/**
 * @deprecated This endpoint is deprecated. Use the Document Builder at /projects/[id]/documents/new instead.
 * Auto-generated documentation has been replaced with user-created documents via the Document Builder wizard.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Return deprecation notice instead of running auto-generation
  return NextResponse.json(
    {
      error: 'This endpoint is deprecated',
      message: 'Auto-generated documentation has been replaced with user-created documents. Please use the Document Builder wizard at /projects/{projectId}/documents/new to create documentation.',
      redirect: `/projects/${params.id}/documents/new`,
    },
    { status: 410 } // 410 Gone - indicates resource is no longer available
  )
}

/**
 * @deprecated This endpoint is deprecated. Use GET /api/projects/[id]/documents instead.
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Return legacy doc_pages for backwards compatibility, but include deprecation notice
  const { data: legacyDocs } = await supabase
    .from('doc_pages')
    .select('slug, title, category, updated_at')
    .eq('project_id', params.id)
    .order('updated_at', { ascending: false })

  // Also get new user-created documents
  const { data: documents } = await supabase
    .from('documents')
    .select('id, slug, title, category, updated_at')
    .eq('project_id', params.id)
    .order('updated_at', { ascending: false })

  return NextResponse.json({
    deprecated: true,
    message: 'This endpoint is deprecated. Please use GET /api/projects/{projectId}/documents instead.',
    legacyDocs: legacyDocs || [],
    documents: documents || [],
    redirect: `/api/projects/${params.id}/documents`,
  })
}
