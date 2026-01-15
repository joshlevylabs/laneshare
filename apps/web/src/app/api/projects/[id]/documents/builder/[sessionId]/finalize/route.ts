import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { DocumentCategory } from '@laneshare/shared'

const DOCUMENT_CATEGORIES: DocumentCategory[] = [
  'architecture',
  'api',
  'feature_guide',
  'runbook',
  'decision',
  'onboarding',
  'meeting_notes',
  'other',
]

const finalizeSchema = z.object({
  markdown: z.string().min(1, 'Document content is required'),
  title: z.string().min(1).max(200).optional(),
  category: z.enum(DOCUMENT_CATEGORIES as [string, ...string[]]).optional(),
  description: z.string().max(2000).optional().nullable(),
  tags: z.array(z.string().max(50)).max(20).optional(),
})

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100)
}

// POST /api/projects/[id]/documents/builder/[sessionId]/finalize - Create document from session
export async function POST(
  request: Request,
  { params }: { params: { id: string; sessionId: string } }
) {
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify user owns this session
  const { data: session } = await supabase
    .from('document_builder_sessions')
    .select('*')
    .eq('id', params.sessionId)
    .eq('project_id', params.id)
    .single()

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  if (session.created_by !== user.id) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Parse request body
  const body = await request.json()
  const result = finalizeSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { markdown } = result.data
  const title = result.data.title || session.title || 'Untitled Document'
  const category = (result.data.category || session.category || 'other') as DocumentCategory
  const description = result.data.description ?? session.description
  const tags = result.data.tags ?? session.tags ?? []

  // Generate unique slug
  let slug = generateSlug(title)
  let slugAttempt = 0
  let finalSlug = slug

  while (true) {
    const { data: existing } = await supabase
      .from('documents')
      .select('id')
      .eq('project_id', params.id)
      .eq('slug', finalSlug)
      .single()

    if (!existing) break

    slugAttempt++
    finalSlug = `${slug}-${slugAttempt}`
    if (slugAttempt > 100) {
      return NextResponse.json(
        { error: 'Could not generate unique slug' },
        { status: 400 }
      )
    }
  }

  // Create the document
  const { data: document, error: docError } = await serviceClient
    .from('documents')
    .insert({
      project_id: params.id,
      title,
      slug: finalSlug,
      category,
      description,
      tags,
      markdown,
      created_by: user.id,
      updated_by: user.id,
    })
    .select()
    .single()

  if (docError) {
    console.error('Failed to create document:', docError)
    return NextResponse.json({ error: docError.message }, { status: 500 })
  }

  // Update session to mark as completed and link to document
  const { error: updateError } = await serviceClient
    .from('document_builder_sessions')
    .update({
      status: 'COMPLETED',
      document_id: document.id,
    })
    .eq('id', params.sessionId)

  if (updateError) {
    console.error('Failed to update session:', updateError)
    // Don't fail - document was created successfully
  }

  // Optionally create references to selected context
  const referencesToCreate: Array<{
    project_id: string
    source_type: string
    source_id: string
    document_id: string
    kind: string
    created_by: string
  }> = []

  // Link to selected tasks
  if (session.selected_task_ids && session.selected_task_ids.length > 0) {
    for (const taskId of session.selected_task_ids) {
      referencesToCreate.push({
        project_id: params.id,
        source_type: 'task',
        source_id: taskId,
        document_id: document.id,
        kind: 'reference',
        created_by: user.id,
      })
    }
  }

  // Link to selected systems
  if (session.selected_system_ids && session.selected_system_ids.length > 0) {
    for (const systemId of session.selected_system_ids) {
      referencesToCreate.push({
        project_id: params.id,
        source_type: 'system',
        source_id: systemId,
        document_id: document.id,
        kind: 'reference',
        created_by: user.id,
      })
    }
  }

  // Link to selected docs (related documents)
  if (session.selected_doc_ids && session.selected_doc_ids.length > 0) {
    for (const docId of session.selected_doc_ids) {
      if (docId !== document.id) {
        referencesToCreate.push({
          project_id: params.id,
          source_type: 'document',
          source_id: docId,
          document_id: document.id,
          kind: 'related',
          created_by: user.id,
        })
      }
    }
  }

  if (referencesToCreate.length > 0) {
    const { error: refError } = await serviceClient
      .from('document_references')
      .insert(referencesToCreate)

    if (refError) {
      console.error('Failed to create references:', refError)
      // Don't fail - document was created successfully
    }
  }

  return NextResponse.json(document, { status: 201 })
}
