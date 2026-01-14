import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { DocumentReferenceKind } from '@laneshare/shared'

const REFERENCE_KINDS: DocumentReferenceKind[] = [
  'related',
  'spec',
  'runbook',
  'adr',
  'guide',
  'reference',
]

const createReferenceSchema = z.object({
  source_type: z.enum(['task', 'system', 'document']),
  source_id: z.string().uuid(),
  kind: z.enum(REFERENCE_KINDS as [string, ...string[]]).default('related'),
})

// GET /api/projects/[id]/documents/[docId]/references - Get references to a document
export async function GET(
  request: Request,
  { params }: { params: { id: string; docId: string } }
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

  // Fetch references to this document
  const { data: references, error } = await supabase
    .from('document_references')
    .select(`
      id,
      project_id,
      source_type,
      source_id,
      document_id,
      kind,
      created_by,
      created_at
    `)
    .eq('document_id', params.docId)
    .eq('project_id', params.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to fetch references:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Fetch source details for each reference
  const tasksToFetch = references.filter((r) => r.source_type === 'task').map((r) => r.source_id)
  const systemsToFetch = references.filter((r) => r.source_type === 'system').map((r) => r.source_id)
  const docsToFetch = references.filter((r) => r.source_type === 'document').map((r) => r.source_id)

  const [tasksResult, systemsResult, docsResult] = await Promise.all([
    tasksToFetch.length > 0
      ? supabase.from('tasks').select('id, key, title, status, type').in('id', tasksToFetch)
      : { data: [] },
    systemsToFetch.length > 0
      ? supabase.from('systems').select('id, name, slug, status').in('id', systemsToFetch)
      : { data: [] },
    docsToFetch.length > 0
      ? supabase.from('documents').select('id, title, slug, category').in('id', docsToFetch)
      : { data: [] },
  ])

  const tasksMap = new Map((tasksResult.data || []).map((t) => [t.id, t]))
  const systemsMap = new Map((systemsResult.data || []).map((s) => [s.id, s]))
  const docsMap = new Map((docsResult.data || []).map((d) => [d.id, d]))

  const referencesWithSources = references.map((ref) => ({
    ...ref,
    source:
      ref.source_type === 'task'
        ? tasksMap.get(ref.source_id)
        : ref.source_type === 'system'
        ? systemsMap.get(ref.source_id)
        : docsMap.get(ref.source_id),
  }))

  return NextResponse.json(referencesWithSources)
}

// POST /api/projects/[id]/documents/[docId]/references - Create a reference
export async function POST(
  request: Request,
  { params }: { params: { id: string; docId: string } }
) {
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

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

  // Parse request body
  const body = await request.json()
  const result = createReferenceSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { source_type, source_id, kind } = result.data

  // Verify the document exists
  const { data: doc } = await supabase
    .from('documents')
    .select('id')
    .eq('id', params.docId)
    .eq('project_id', params.id)
    .single()

  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  // Verify the source exists in the same project
  let sourceExists = false
  if (source_type === 'task') {
    const { data } = await supabase
      .from('tasks')
      .select('id')
      .eq('id', source_id)
      .eq('project_id', params.id)
      .single()
    sourceExists = !!data
  } else if (source_type === 'system') {
    const { data } = await supabase
      .from('systems')
      .select('id')
      .eq('id', source_id)
      .eq('project_id', params.id)
      .single()
    sourceExists = !!data
  } else if (source_type === 'document') {
    const { data } = await supabase
      .from('documents')
      .select('id')
      .eq('id', source_id)
      .eq('project_id', params.id)
      .single()
    sourceExists = !!data
  }

  if (!sourceExists) {
    return NextResponse.json({ error: 'Source entity not found' }, { status: 404 })
  }

  // Create reference
  const { data: reference, error } = await serviceClient
    .from('document_references')
    .insert({
      project_id: params.id,
      source_type,
      source_id,
      document_id: params.docId,
      kind,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to create reference:', error)
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'This reference already exists' },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(reference, { status: 201 })
}

// DELETE /api/projects/[id]/documents/[docId]/references - Delete a reference
export async function DELETE(
  request: Request,
  { params }: { params: { id: string; docId: string } }
) {
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

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

  // Parse request body
  const body = await request.json()
  const referenceId = body.reference_id

  if (!referenceId) {
    return NextResponse.json({ error: 'reference_id is required' }, { status: 400 })
  }

  // Delete reference
  const { error } = await serviceClient
    .from('document_references')
    .delete()
    .eq('id', referenceId)
    .eq('document_id', params.docId)
    .eq('project_id', params.id)

  if (error) {
    console.error('Failed to delete reference:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
