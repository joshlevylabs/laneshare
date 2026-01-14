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

const updateDocumentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  category: z.enum(DOCUMENT_CATEGORIES as [string, ...string[]]).optional(),
  description: z.string().max(2000).optional().nullable(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  markdown: z.string().optional(),
})

// GET /api/projects/[id]/documents/[docId] - Get a single document
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

  // Fetch document with creator and updater info
  const { data: document, error } = await supabase
    .from('documents')
    .select(`
      id,
      project_id,
      title,
      slug,
      category,
      description,
      tags,
      markdown,
      created_by,
      created_at,
      updated_by,
      updated_at,
      creator:profiles!documents_created_by_fkey (
        id,
        email,
        full_name,
        avatar_url
      ),
      updater:profiles!documents_updated_by_fkey (
        id,
        email,
        full_name,
        avatar_url
      )
    `)
    .eq('id', params.docId)
    .eq('project_id', params.id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Get reference count
  const { count: referenceCount } = await supabase
    .from('document_references')
    .select('id', { count: 'exact', head: true })
    .eq('document_id', params.docId)

  return NextResponse.json({
    ...document,
    reference_count: referenceCount || 0,
  })
}

// PATCH /api/projects/[id]/documents/[docId] - Update a document
export async function PATCH(
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
  const result = updateDocumentSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const updateData: Record<string, unknown> = {
    updated_by: user.id,
  }

  if (result.data.title !== undefined) updateData.title = result.data.title
  if (result.data.category !== undefined) updateData.category = result.data.category
  if (result.data.description !== undefined) updateData.description = result.data.description
  if (result.data.tags !== undefined) updateData.tags = result.data.tags
  if (result.data.markdown !== undefined) updateData.markdown = result.data.markdown

  // Update document
  const { data: document, error } = await serviceClient
    .from('documents')
    .update(updateData)
    .eq('id', params.docId)
    .eq('project_id', params.id)
    .select()
    .single()

  if (error) {
    console.error('Failed to update document:', error)
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(document)
}

// DELETE /api/projects/[id]/documents/[docId] - Delete a document
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

  // Check admin access
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  // Delete document (references will cascade)
  const { error } = await serviceClient
    .from('documents')
    .delete()
    .eq('id', params.docId)
    .eq('project_id', params.id)

  if (error) {
    console.error('Failed to delete document:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
