import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const addRepoSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  defaultBranch: z.string().default('main'),
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

  const { data: repos, error } = await supabase
    .from('repos')
    .select('*')
    .eq('project_id', params.id)
    .order('installed_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(repos)
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

  // Check project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json(
      { error: 'Only project owners and maintainers can add repositories' },
      { status: 403 }
    )
  }

  const body = await request.json()
  const result = addRepoSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { owner, name, defaultBranch } = result.data

  // Check if repo already exists
  const { data: existing } = await supabase
    .from('repos')
    .select('id')
    .eq('project_id', params.id)
    .eq('owner', owner)
    .eq('name', name)
    .single()

  if (existing) {
    return NextResponse.json(
      { error: 'This repository is already added to the project' },
      { status: 400 }
    )
  }

  // Add the repo
  const { data: repo, error } = await supabase
    .from('repos')
    .insert({
      project_id: params.id,
      provider: 'github',
      owner,
      name,
      default_branch: defaultBranch,
      status: 'PENDING',
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(repo, { status: 201 })
}
