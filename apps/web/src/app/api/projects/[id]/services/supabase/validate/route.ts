/**
 * Validate Supabase connection
 * POST /api/projects/[id]/services/supabase/validate
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createSupabaseAdapter } from '@/lib/services'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const validateSchema = z.object({
  supabase_url: z.string().url('Invalid Supabase URL'),
  service_role_key: z.string().min(20, 'Invalid service role key'),
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

  const { supabase_url, service_role_key } = validation.data

  // Validate connection using the adapter
  const adapter = createSupabaseAdapter()
  const result = await adapter.validateConnection(
    { supabase_url },
    { service_role_key }
  )

  if (!result.valid) {
    return NextResponse.json(
      { error: result.error || 'Connection validation failed' },
      { status: 400 }
    )
  }

  return NextResponse.json({
    valid: true,
    metadata: result.metadata,
  })
}
