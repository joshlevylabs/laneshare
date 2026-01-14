import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { DocumentCategory, DocumentBuilderStatus } from '@laneshare/shared'

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

const BUILDER_STATUSES: DocumentBuilderStatus[] = [
  'BASICS',
  'INTERVIEW',
  'CONTEXT',
  'PROMPTS',
  'EDITING',
  'COMPLETED',
]

const updateSessionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  category: z.enum(DOCUMENT_CATEGORIES as [string, ...string[]]).optional(),
  description: z.string().max(2000).optional().nullable(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  interview_messages: z.array(z.object({
    id: z.string(),
    sender: z.enum(['USER', 'AI']),
    content: z.string(),
    timestamp: z.string(),
  })).optional(),
  interview_answers: z.record(z.unknown()).optional(),
  selected_repo_ids: z.array(z.string().uuid()).optional(),
  selected_service_ids: z.array(z.string().uuid()).optional(),
  selected_system_ids: z.array(z.string().uuid()).optional(),
  selected_task_ids: z.array(z.string().uuid()).optional(),
  selected_doc_ids: z.array(z.string().uuid()).optional(),
  context_keywords: z.array(z.string()).optional(),
  outline_markdown: z.string().optional().nullable(),
  status: z.enum(BUILDER_STATUSES as [string, ...string[]]).optional(),
})

// GET /api/projects/[id]/documents/builder/[sessionId] - Get a builder session
export async function GET(
  request: Request,
  { params }: { params: { id: string; sessionId: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch session
  const { data: session, error } = await supabase
    .from('document_builder_sessions')
    .select('*')
    .eq('id', params.sessionId)
    .eq('project_id', params.id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Check access (creator or project member)
  if (session.created_by !== user.id) {
    const { data: membership } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', params.id)
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
  }

  return NextResponse.json(session)
}

// PATCH /api/projects/[id]/documents/builder/[sessionId] - Update a builder session
export async function PATCH(
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
  const { data: existing } = await supabase
    .from('document_builder_sessions')
    .select('created_by')
    .eq('id', params.sessionId)
    .eq('project_id', params.id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  if (existing.created_by !== user.id) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Parse request body
  const body = await request.json()
  const result = updateSessionSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // Build update object
  const updateData: Record<string, unknown> = {}
  const data = result.data

  if (data.title !== undefined) updateData.title = data.title
  if (data.category !== undefined) updateData.category = data.category
  if (data.description !== undefined) updateData.description = data.description
  if (data.tags !== undefined) updateData.tags = data.tags
  if (data.interview_messages !== undefined) updateData.interview_messages = data.interview_messages
  if (data.interview_answers !== undefined) updateData.interview_answers = data.interview_answers
  if (data.selected_repo_ids !== undefined) updateData.selected_repo_ids = data.selected_repo_ids
  if (data.selected_service_ids !== undefined) updateData.selected_service_ids = data.selected_service_ids
  if (data.selected_system_ids !== undefined) updateData.selected_system_ids = data.selected_system_ids
  if (data.selected_task_ids !== undefined) updateData.selected_task_ids = data.selected_task_ids
  if (data.selected_doc_ids !== undefined) updateData.selected_doc_ids = data.selected_doc_ids
  if (data.context_keywords !== undefined) updateData.context_keywords = data.context_keywords
  if (data.outline_markdown !== undefined) updateData.outline_markdown = data.outline_markdown
  if (data.status !== undefined) updateData.status = data.status

  // Update session
  const { data: session, error } = await serviceClient
    .from('document_builder_sessions')
    .update(updateData)
    .eq('id', params.sessionId)
    .eq('project_id', params.id)
    .select()
    .single()

  if (error) {
    console.error('Failed to update session:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(session)
}

// DELETE /api/projects/[id]/documents/builder/[sessionId] - Delete a builder session
export async function DELETE(
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
  const { data: existing } = await supabase
    .from('document_builder_sessions')
    .select('created_by')
    .eq('id', params.sessionId)
    .eq('project_id', params.id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  if (existing.created_by !== user.id) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Delete session
  const { error } = await serviceClient
    .from('document_builder_sessions')
    .delete()
    .eq('id', params.sessionId)
    .eq('project_id', params.id)

  if (error) {
    console.error('Failed to delete session:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
