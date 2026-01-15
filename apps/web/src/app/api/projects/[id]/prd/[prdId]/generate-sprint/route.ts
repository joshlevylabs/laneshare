import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { PRDJson, PRDUserStory } from '@laneshare/shared'

const generateSprintSchema = z.object({
  // Which user stories to include (by ID like "US-001")
  story_ids: z.array(z.string()).min(1),
  // Sprint details
  sprint_name: z.string().min(1).max(100),
  sprint_goal: z.string().max(500).optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  // Optional assignee for all tasks
  default_assignee_id: z.string().uuid().nullable().optional(),
})

export async function POST(
  request: Request,
  { params }: { params: { id: string; prdId: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check membership - require OWNER or MAINTAINER to create sprints
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json({ error: 'Only project admins can generate sprints' }, { status: 403 })
  }

  const body = await request.json()
  console.log('[generate-sprint] Request body:', JSON.stringify(body, null, 2))

  const result = generateSprintSchema.safeParse(body)

  if (!result.success) {
    console.error('[generate-sprint] Validation failed:', result.error.flatten())
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // Get PRD with JSON
  const { data: prd, error: prdError } = await supabase
    .from('project_prds')
    .select('*')
    .eq('id', params.prdId)
    .eq('project_id', params.id)
    .single()

  if (prdError || !prd) {
    console.error('[generate-sprint] PRD not found:', prdError)
    return NextResponse.json({ error: 'PRD not found' }, { status: 404 })
  }

  console.log('[generate-sprint] PRD status:', prd.status, 'has prd_json:', !!prd.prd_json)

  // Allow READY or PROCESSING status (PROCESSING means sprints have already been generated)
  if (!prd.prd_json || !['READY', 'PROCESSING'].includes(prd.status)) {
    console.error('[generate-sprint] PRD not ready. Status:', prd.status, 'Has JSON:', !!prd.prd_json)
    return NextResponse.json({ error: 'PRD must be converted to JSON first' }, { status: 400 })
  }

  const prdJson = prd.prd_json as unknown as PRDJson

  console.log('[generate-sprint] Request story_ids:', result.data.story_ids)
  console.log('[generate-sprint] PRD userStories IDs:', prdJson.userStories.map((s: PRDUserStory) => s.id))

  // Filter stories by requested IDs
  const selectedStories = prdJson.userStories.filter((story: PRDUserStory) =>
    result.data.story_ids.includes(story.id)
  )

  console.log('[generate-sprint] Selected stories:', selectedStories.length)

  if (selectedStories.length === 0) {
    return NextResponse.json({ error: 'No matching user stories found' }, { status: 400 })
  }

  // Check for already-generated stories
  const { data: existingStoryTasks, error: existingError } = await supabase
    .from('prd_story_tasks')
    .select('user_story_id')
    .eq('prd_id', params.prdId)
    .in('user_story_id', result.data.story_ids)

  if (existingError) {
    console.error('[generate-sprint] Error checking existing story tasks:', existingError)
  }

  const alreadyGenerated = existingStoryTasks?.map(st => st.user_story_id) || []
  console.log('[generate-sprint] Already generated story IDs:', alreadyGenerated)

  const newStories = selectedStories.filter((story: PRDUserStory) => !alreadyGenerated.includes(story.id))

  console.log('[generate-sprint] New stories to create:', newStories.length)

  if (newStories.length === 0) {
    return NextResponse.json({ error: 'All selected stories have already been generated as tasks' }, { status: 400 })
  }

  // Create sprint
  const { data: sprint, error: sprintError } = await supabase
    .from('sprints')
    .insert({
      project_id: params.id,
      name: result.data.sprint_name,
      goal: result.data.sprint_goal,
      start_date: result.data.start_date,
      end_date: result.data.end_date,
      status: 'PLANNED',
    })
    .select()
    .single()

  if (sprintError) {
    return NextResponse.json({ error: sprintError.message }, { status: 500 })
  }

  // Create PRD-Sprint link
  const { error: linkError } = await supabase
    .from('prd_sprints')
    .insert({
      prd_id: params.prdId,
      sprint_id: sprint.id,
      project_id: params.id,
      user_story_ids: newStories.map((s: PRDUserStory) => s.id),
      implementation_status: 'PENDING',
    })

  if (linkError) {
    console.error('Error creating PRD-Sprint link:', linkError)
  }

  // Create tasks for each story
  const createdTasks: Array<{ story_id: string; task: Record<string, unknown> }> = []
  const errors: string[] = []

  console.log(`[generate-sprint] Creating ${newStories.length} tasks from stories:`, newStories.map((s: PRDUserStory) => s.id))

  for (const story of newStories as PRDUserStory[]) {
    // Calculate story points from estimatedPoints or default based on priority
    const storyPoints = story.estimatedPoints || (6 - story.priority) // Priority 1 = 5 points, Priority 5 = 1 point

    // Build description with acceptance criteria
    const description = `${story.description}

## Acceptance Criteria
${story.acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join('\n')}

${story.notes ? `\n## Notes\n${story.notes}` : ''}

---
*Generated from PRD: ${prd.title}*
*User Story: ${story.id}*`

    // Create the task
    // The key should be auto-generated by the database, but insert it as a fallback
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .insert({
        project_id: params.id,
        key: `PRD-${story.id}`, // Fallback key if not auto-generated
        title: story.title, // Clean title without [US-xxx] prefix - the story ID is tracked in prd_story_tasks
        description,
        type: 'STORY', // User stories become STORY type tasks
        status: 'TODO', // Use TODO so tasks appear on kanban board (BACKLOG is for unplanned tasks)
        priority: story.priority <= 2 ? 'HIGH' : story.priority <= 3 ? 'MEDIUM' : 'LOW',
        story_points: storyPoints,
        sprint_id: sprint.id,
        assignee_id: result.data.default_assignee_id,
        reporter_id: user.id,
        labels: ['prd-generated', story.id], // Include story ID in labels for reference
      })
      .select()
      .single()

    if (taskError) {
      console.error(`[generate-sprint] Task creation failed for ${story.id}:`, taskError)
      errors.push(`${story.id}: ${taskError.message}`)
      continue
    }

    console.log(`[generate-sprint] Task created for ${story.id}:`, task.id, task.key)

    // Create PRD story-task mapping
    const { error: mappingError } = await supabase
      .from('prd_story_tasks')
      .insert({
        prd_id: params.prdId,
        project_id: params.id,
        user_story_id: story.id,
        task_id: task.id,
        passes: false,
      })

    if (mappingError) {
      console.error(`Error creating story-task mapping for ${story.id}:`, mappingError)
    }

    // Create context links if story has linkedRepoIds, linkedDocIds, linkedFeatureIds
    if (story.linkedRepoIds && story.linkedRepoIds.length > 0) {
      const repoLinks = story.linkedRepoIds.map(repoId => ({
        task_id: task.id,
        project_id: params.id,
        repo_id: repoId,
        created_by: user.id,
      }))
      await supabase.from('task_repo_links').insert(repoLinks)
    }

    if (story.linkedDocIds && story.linkedDocIds.length > 0) {
      const docLinks = story.linkedDocIds.map(docId => ({
        task_id: task.id,
        project_id: params.id,
        doc_id: docId,
        created_by: user.id,
      }))
      await supabase.from('task_doc_links').insert(docLinks)
    }

    if (story.linkedFeatureIds && story.linkedFeatureIds.length > 0) {
      const featureLinks = story.linkedFeatureIds.map(featureId => ({
        task_id: task.id,
        project_id: params.id,
        feature_id: featureId,
        created_by: user.id,
      }))
      await supabase.from('task_feature_links').insert(featureLinks)
    }

    createdTasks.push({ story_id: story.id, task })
  }

  // Update PRD status to PROCESSING if tasks were created
  if (createdTasks.length > 0) {
    await supabase
      .from('project_prds')
      .update({ status: 'PROCESSING' })
      .eq('id', params.prdId)
  }

  return NextResponse.json({
    sprint,
    created_tasks: createdTasks,
    errors: errors.length > 0 ? errors : undefined,
    skipped_stories: alreadyGenerated.length > 0 ? alreadyGenerated : undefined,
  }, { status: 201 })
}
