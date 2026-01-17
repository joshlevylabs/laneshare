// @ts-nocheck
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const createSidequestSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  repo_ids: z.array(z.string().uuid()).min(1, 'At least one repository is required'),
})

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

  // Check membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Get sidequests with creator profile and repo info
  const { data: sidequests, error } = await supabase
    .from('sidequests')
    .select(`
      *,
      creator:profiles!created_by(id, email, full_name, avatar_url)
    `)
    .eq('project_id', params.id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Fetch repo details for each sidequest
  const sidequestsWithRepos = await Promise.all(
    (sidequests || []).map(async (sq) => {
      if (sq.repo_ids && sq.repo_ids.length > 0) {
        const { data: repos } = await supabase
          .from('repos')
          .select('id, owner, name, default_branch')
          .in('id', sq.repo_ids)

        return { ...sq, repos: repos || [] }
      }
      return { ...sq, repos: [] }
    })
  )

  return NextResponse.json(sidequestsWithRepos)
}

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

  // Check membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const body = await request.json()
  const result = createSidequestSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // Verify all repo_ids belong to this project
  const { data: repos, error: repoError } = await supabase
    .from('repos')
    .select('id')
    .eq('project_id', params.id)
    .in('id', result.data.repo_ids)

  if (repoError) {
    return NextResponse.json({ error: repoError.message }, { status: 500 })
  }

  if (!repos || repos.length !== result.data.repo_ids.length) {
    return NextResponse.json(
      { error: 'One or more repositories do not belong to this project' },
      { status: 400 }
    )
  }

  // Create the sidequest
  const { data: sidequest, error } = await supabase
    .from('sidequests')
    .insert({
      project_id: params.id,
      title: result.data.title,
      description: result.data.description,
      repo_ids: result.data.repo_ids,
      status: 'PLANNING',
      created_by: user.id,
    })
    .select(`
      *,
      creator:profiles!created_by(id, email, full_name, avatar_url)
    `)
    .single()

  if (error) {
    console.error('Sidequest creation error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Fetch repo details
  const { data: repoDetails } = await supabase
    .from('repos')
    .select('id, owner, name, default_branch')
    .in('id', result.data.repo_ids)

  // Create initial system message for the chat
  const { error: chatError } = await supabase
    .from('sidequest_chat_messages')
    .insert({
      sidequest_id: sidequest.id,
      project_id: params.id,
      sender: 'SYSTEM',
      content: `Welcome to your new Sidequest: "${result.data.title}"! I'm here to help you plan this project. Let's start by understanding what you want to build. What's the main goal or problem you're trying to solve?`,
      created_by: null,
    })

  if (chatError) {
    console.error('Failed to create initial chat message:', chatError)
    // Don't fail the request, just log the error
  }

  return NextResponse.json(
    { ...sidequest, repos: repoDetails || [] },
    { status: 201 }
  )
}
