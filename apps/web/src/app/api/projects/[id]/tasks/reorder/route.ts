import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const reorderSchema = z.object({
  task_id: z.string().uuid(),
  new_rank: z.number(),
  new_status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE']).optional(),
  new_sprint_id: z.string().uuid().nullable().optional(),
})

const bulkReorderSchema = z.object({
  updates: z.array(reorderSchema),
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

  const body = await request.json()
  const result = bulkReorderSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // Perform bulk updates
  const errors: string[] = []

  for (const update of result.data.updates) {
    const updateData: Record<string, unknown> = { rank: update.new_rank }

    if (update.new_status !== undefined) {
      updateData.status = update.new_status
    }

    if (update.new_sprint_id !== undefined) {
      updateData.sprint_id = update.new_sprint_id
    }

    const { error } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', update.task_id)
      .eq('project_id', params.id)

    if (error) {
      errors.push(`Failed to update task ${update.task_id}: ${error.message}`)
    }
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { error: 'Some updates failed', details: errors },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}

// Calculate rank between two adjacent items
function calculateRank(before: number | null, after: number | null): number {
  if (before === null && after === null) {
    return 1000
  }
  if (before === null) {
    return after! - 1000
  }
  if (after === null) {
    return before + 1000
  }
  return (before + after) / 2
}
