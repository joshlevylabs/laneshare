/**
 * Validate Vercel connection
 * POST /api/projects/[id]/services/vercel/validate
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createVercelAdapter } from '@/lib/services'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const validateSchema = z.object({
  token: z.string().min(20, 'Invalid Vercel token'),
  team_id: z.string().optional(),
})

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

  // Verify project admin access (OWNER or MAINTAINER)
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json(
      { error: 'Only project owners and maintainers can manage service connections' },
      { status: 403 }
    )
  }

  // Parse and validate request body
  const body = await request.json()
  const validation = validateSchema.safeParse(body)

  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { token, team_id } = validation.data

  // Validate connection using the adapter
  const adapter = createVercelAdapter()
  const result = await adapter.validateConnection(
    { team_id },
    { token }
  )

  if (!result.valid) {
    return NextResponse.json(
      { error: result.error || 'Connection validation failed' },
      { status: 400 }
    )
  }

  // Also fetch available teams and projects for UI selection
  const teams = await adapter.fetchTeams(token)
  const projects = await adapter.fetchProjectsForSelection(token, team_id)

  return NextResponse.json({
    valid: true,
    metadata: result.metadata,
    teams,
    projects,
  })
}
