import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
})

export async function GET() {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: projects, error } = await supabase
    .from('projects')
    .select(`
      *,
      project_members!inner (
        user_id,
        role
      )
    `)
    .eq('project_members.user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(projects)
}

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const result = createProjectSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { name, description } = result.data

  // Create project
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert({
      owner_id: user.id,
      name,
      description: description || null,
    })
    .select()
    .single()

  if (projectError) {
    return NextResponse.json({ error: projectError.message }, { status: 500 })
  }

  // Add owner as member
  const { error: memberError } = await supabase.from('project_members').insert({
    project_id: project.id,
    user_id: user.id,
    role: 'OWNER',
  })

  if (memberError) {
    // Rollback project creation
    await supabase.from('projects').delete().eq('id', project.id)
    return NextResponse.json({ error: memberError.message }, { status: 500 })
  }

  // Create default documentation pages
  const defaultDocs = [
    {
      project_id: project.id,
      slug: 'architecture/overview',
      title: 'Architecture Overview',
      category: 'architecture' as const,
      markdown: `# Architecture Overview\n\nThis document describes the overall architecture of the project.\n\n## Components\n\n*Add your architecture documentation here*`,
    },
    {
      project_id: project.id,
      slug: 'features/index',
      title: 'Features',
      category: 'features' as const,
      markdown: `# Features\n\nThis document lists the main features of the project.\n\n*Add your feature documentation here*`,
    },
    {
      project_id: project.id,
      slug: 'decisions/index',
      title: 'Decision Log',
      category: 'decisions' as const,
      markdown: `# Decision Log\n\nThis document tracks architectural decisions made in the project.\n\n*Decision entries will be added here*`,
    },
    {
      project_id: project.id,
      slug: 'status/current',
      title: 'Project Status',
      category: 'status' as const,
      markdown: `# Project Status\n\nCurrent status and progress of the project.\n\n*Status updates will be added here*`,
    },
  ]

  await supabase.from('doc_pages').insert(defaultDocs)

  return NextResponse.json(project, { status: 201 })
}
