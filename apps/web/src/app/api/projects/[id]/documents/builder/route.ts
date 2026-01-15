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

const createSessionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  category: z.enum(DOCUMENT_CATEGORIES as [string, ...string[]]).optional(),
  description: z.string().max(2000).optional(),
})

// GET /api/projects/[id]/documents/builder - List builder sessions for current user
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

  // Fetch sessions for current user (excluding completed)
  const { data: sessions, error } = await supabase
    .from('document_builder_sessions')
    .select(`
      id,
      project_id,
      title,
      category,
      status,
      created_at,
      updated_at
    `)
    .eq('project_id', params.id)
    .eq('created_by', user.id)
    .neq('status', 'COMPLETED')
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('Failed to fetch sessions:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(sessions)
}

// POST /api/projects/[id]/documents/builder - Create a new builder session
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
  const result = createSessionSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // Create session
  const { data: session, error } = await serviceClient
    .from('document_builder_sessions')
    .insert({
      project_id: params.id,
      created_by: user.id,
      title: result.data.title,
      category: result.data.category as DocumentCategory | undefined,
      description: result.data.description,
      status: 'BASICS',
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to create session:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(session, { status: 201 })
}
