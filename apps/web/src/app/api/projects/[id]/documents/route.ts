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

const createDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).optional(),
  category: z.enum(DOCUMENT_CATEGORIES as [string, ...string[]]),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  markdown: z.string().default(''),
})

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100)
}

// GET /api/projects/[id]/documents - List all documents for a project
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

  // Parse query parameters
  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category')
  const search = searchParams.get('search')

  // Build query
  let query = supabase
    .from('documents')
    .select(`
      id,
      project_id,
      title,
      slug,
      category,
      description,
      tags,
      created_by,
      created_at,
      updated_by,
      updated_at,
      profiles!documents_created_by_fkey (
        id,
        email,
        full_name,
        avatar_url
      )
    `)
    .eq('project_id', params.id)
    .order('updated_at', { ascending: false })

  if (category && DOCUMENT_CATEGORIES.includes(category as DocumentCategory)) {
    query = query.eq('category', category as DocumentCategory)
  }

  if (search) {
    query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`)
  }

  const { data: documents, error } = await query

  if (error) {
    console.error('Failed to fetch documents:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Transform to include creator info
  const docsWithCreator = (documents || []).map((doc) => {
    const { profiles, ...docData } = doc as typeof doc & { profiles: unknown }
    return {
      ...docData,
      creator: profiles,
    }
  })

  return NextResponse.json(docsWithCreator)
}

// POST /api/projects/[id]/documents - Create a new document
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
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
  const result = createDocumentSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { title, category, description, tags, markdown } = result.data
  let slug = result.data.slug || generateSlug(title)

  // Check for duplicate slug and make unique if needed
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

  // Create document
  const { data: document, error } = await serviceClient
    .from('documents')
    .insert({
      project_id: params.id,
      title,
      slug: finalSlug,
      category: category as DocumentCategory,
      description,
      tags: tags || [],
      markdown,
      created_by: user.id,
      updated_by: user.id,
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to create document:', error)
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'A document with this slug already exists' },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(document, { status: 201 })
}

// DELETE /api/projects/[id]/documents - Bulk delete documents
const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
})

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check admin access (OWNER or MAINTAINER required for delete)
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  // Parse request body
  const body = await request.json()
  const result = bulkDeleteSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { ids } = result.data

  // Delete documents (only ones belonging to this project)
  const { error, count } = await serviceClient
    .from('documents')
    .delete()
    .eq('project_id', params.id)
    .in('id', ids)

  if (error) {
    console.error('Failed to delete documents:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    deleted: count || ids.length
  })
}
