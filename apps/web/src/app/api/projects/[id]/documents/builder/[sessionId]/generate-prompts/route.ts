import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { DocumentCategory, GeneratedPrompt, ContextPackJson, DocumentInterviewAnswers } from '@laneshare/shared'

// System prompt for prompt generation
const PROMPT_GENERATOR_SYSTEM = `You are LanePilot, an AI assistant that generates coding agent prompts for documentation creation.

Your task is to create structured prompts that a user can paste into their coding agent (Claude Code, Cursor, GitHub Copilot, etc.) to help write documentation.

Based on the user's requirements and selected context, generate:
1. A document outline (markdown headings structure)
2. 2-3 focused prompts targeting different aspects:
   - Repo-focused: For code exploration and technical documentation
   - Service-focused: For API/service documentation
   - Integration: For cross-cutting concerns and high-level architecture

Each prompt MUST:
- Be self-contained and copy-pasteable
- Clearly specify what files/endpoints/tables to examine
- Request structured output in markdown format
- Ask for evidence citations (file paths, line numbers, endpoint URLs)
- Match the requested document outline structure

Format your response as JSON with this structure:
{
  "outline": "# Document Title\\n## Section 1\\n### Subsection...\\n## Section 2...",
  "prompts": [
    {
      "id": "prompt-1",
      "title": "Code Structure Analysis",
      "type": "repo",
      "prompt": "The full prompt text...",
      "targetContext": "Description of what context this targets"
    }
  ],
  "contextPack": {
    "summary": "Brief summary of context being used",
    "relevantFiles": ["path/to/file.ts"],
    "relevantEndpoints": ["GET /api/users"]
  }
}`

interface ContextData {
  repos: Array<{ id: string; name: string; owner: string }>
  services: Array<{ id: string; display_name: string; service: string }>
  systems: Array<{ id: string; name: string; description?: string }>
  tasks: Array<{ id: string; key: string; title: string; description?: string }>
  docs: Array<{ id: string; title: string; slug: string; category?: string }>
}

// POST /api/projects/[id]/documents/builder/[sessionId]/generate-prompts
export async function POST(
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
  const { data: session } = await supabase
    .from('document_builder_sessions')
    .select('*')
    .eq('id', params.sessionId)
    .eq('project_id', params.id)
    .single()

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  if (session.created_by !== user.id) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Gather context from selected sources
  const contextData: ContextData = {
    repos: [],
    services: [],
    systems: [],
    tasks: [],
    docs: [],
  }

  // Fetch selected repos
  if (session.selected_repo_ids?.length > 0) {
    const { data: repos } = await supabase
      .from('repos')
      .select('id, name, owner')
      .in('id', session.selected_repo_ids)
    contextData.repos = repos || []
  }

  // Fetch selected services
  if (session.selected_service_ids?.length > 0) {
    const { data: services } = await supabase
      .from('project_service_connections')
      .select('id, display_name, service')
      .in('id', session.selected_service_ids)
    contextData.services = services || []
  }

  // Fetch selected systems
  if (session.selected_system_ids?.length > 0) {
    const { data: systems } = await supabase
      .from('systems')
      .select('id, name, description')
      .in('id', session.selected_system_ids)
    contextData.systems = systems || []
  }

  // Fetch selected tasks
  if (session.selected_task_ids?.length > 0) {
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, key, title, description')
      .in('id', session.selected_task_ids)
    contextData.tasks = tasks || []
  }

  // Fetch selected docs
  if (session.selected_doc_ids?.length > 0) {
    const { data: docs } = await supabase
      .from('documents')
      .select('id, title, slug, category')
      .in('id', session.selected_doc_ids)
    contextData.docs = docs || []
  }

  // Build the context summary for the AI
  const interviewAnswers = (session.interview_answers || {}) as DocumentInterviewAnswers
  const interviewMessages = session.interview_messages || []

  const contextSummary = buildContextSummary(session, contextData, interviewAnswers, interviewMessages)

  try {
    const anthropic = new Anthropic()

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: PROMPT_GENERATOR_SYSTEM,
      messages: [
        {
          role: 'user',
          content: contextSummary,
        },
      ],
    })

    const responseText =
      response.content[0].type === 'text' ? response.content[0].text : ''

    // Parse the JSON response
    let parsedResponse: {
      outline: string
      prompts: GeneratedPrompt[]
      contextPack: ContextPackJson
    }

    try {
      // Extract JSON from possible markdown code blocks
      const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/) ||
                       responseText.match(/```\n?([\s\S]*?)\n?```/)
      const jsonStr = jsonMatch ? jsonMatch[1] : responseText
      parsedResponse = JSON.parse(jsonStr)
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError)
      // Fallback: Create a basic structure
      parsedResponse = {
        outline: `# ${session.title || 'Document'}\n\n## Overview\n\n## Details\n\n## Conclusion`,
        prompts: [
          {
            id: 'prompt-fallback',
            title: 'General Documentation',
            type: 'integration',
            prompt: `Please help me write documentation for: ${session.title || 'this project'}\n\nContext: ${session.description || 'No description provided'}`,
            targetContext: 'General project context',
          },
        ],
        contextPack: {
          repos: contextData.repos.map((r) => ({ id: r.id, name: r.name, owner: r.owner })),
          services: contextData.services.map((s) => ({ id: s.id, name: s.display_name, type: s.service })),
          systems: contextData.systems.map((s) => ({ id: s.id, name: s.name })),
          tasks: contextData.tasks.map((t) => ({ id: t.id, key: t.key, title: t.title })),
          docs: contextData.docs.map((d) => ({ id: d.id, title: d.title })),
          keywords: session.context_keywords || [],
        },
      }
    }

    // Ensure prompts have proper IDs
    parsedResponse.prompts = parsedResponse.prompts.map((p, i) => ({
      ...p,
      id: p.id || `prompt-${i + 1}`,
      type: p.type || 'integration',
    }))

    // Update session with generated prompts
    const { error: updateError } = await serviceClient
      .from('document_builder_sessions')
      .update({
        outline_markdown: parsedResponse.outline,
        generated_prompts: parsedResponse.prompts,
        context_pack_json: parsedResponse.contextPack,
        status: 'PROMPTS',
      })
      .eq('id', params.sessionId)

    if (updateError) {
      console.error('Failed to update session:', updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({
      outline: parsedResponse.outline,
      prompts: parsedResponse.prompts,
      contextPack: parsedResponse.contextPack,
    })
  } catch (error) {
    console.error('Failed to generate prompts:', error)
    return NextResponse.json(
      { error: 'Failed to generate prompts' },
      { status: 500 }
    )
  }
}

function buildContextSummary(
  session: {
    title?: string
    category?: DocumentCategory
    description?: string
    context_keywords?: string[]
  },
  contextData: ContextData,
  interviewAnswers: DocumentInterviewAnswers,
  interviewMessages: Array<{ sender: string; content: string }>
): string {
  const parts: string[] = []

  parts.push('# Document Requirements\n')
  parts.push(`Title: ${session.title || '(untitled)'}`)
  parts.push(`Category: ${session.category || '(not set)'}`)
  if (session.description) {
    parts.push(`Description: ${session.description}`)
  }

  if (Object.keys(interviewAnswers).length > 0) {
    parts.push('\n## Interview Answers')
    if (interviewAnswers.goal) parts.push(`Goal: ${interviewAnswers.goal}`)
    if (interviewAnswers.audience) parts.push(`Audience: ${interviewAnswers.audience}`)
    if (interviewAnswers.sections?.length) {
      parts.push(`Sections: ${interviewAnswers.sections.join(', ')}`)
    }
    if (interviewAnswers.contextNeeds) {
      parts.push(`Context Needs: ${interviewAnswers.contextNeeds}`)
    }
    if (interviewAnswers.constraints) {
      parts.push(`Constraints: ${interviewAnswers.constraints}`)
    }
  }

  // Include interview conversation summary
  if (interviewMessages.length > 0) {
    parts.push('\n## Interview Conversation')
    for (const msg of interviewMessages.slice(-6)) {
      parts.push(`${msg.sender}: ${msg.content.slice(0, 500)}${msg.content.length > 500 ? '...' : ''}`)
    }
  }

  parts.push('\n# Selected Context Sources\n')

  if (contextData.repos.length > 0) {
    parts.push('## Repositories')
    for (const repo of contextData.repos) {
      parts.push(`- ${repo.owner}/${repo.name}`)
    }
  }

  if (contextData.services.length > 0) {
    parts.push('\n## Connected Services')
    for (const svc of contextData.services) {
      parts.push(`- ${svc.display_name} (${svc.service})`)
    }
  }

  if (contextData.systems.length > 0) {
    parts.push('\n## Systems')
    for (const sys of contextData.systems) {
      parts.push(`- ${sys.name}${sys.description ? `: ${sys.description}` : ''}`)
    }
  }

  if (contextData.tasks.length > 0) {
    parts.push('\n## Related Tasks')
    for (const task of contextData.tasks) {
      parts.push(`- ${task.key}: ${task.title}`)
    }
  }

  if (contextData.docs.length > 0) {
    parts.push('\n## Related Documents')
    for (const doc of contextData.docs) {
      parts.push(`- ${doc.title} (${doc.category || 'other'})`)
    }
  }

  if (session.context_keywords?.length) {
    parts.push('\n## Keywords')
    parts.push(session.context_keywords.join(', '))
  }

  parts.push('\n---')
  parts.push('Based on the above, generate an outline and 2-3 focused coding agent prompts.')
  parts.push('Return your response as JSON matching the specified structure.')

  return parts.join('\n')
}
