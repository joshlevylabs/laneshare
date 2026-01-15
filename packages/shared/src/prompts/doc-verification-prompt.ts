/**
 * Documentation Verification Prompt Generator
 *
 * Generates prompts for Claude Code to verify auto-generated documentation
 * against the actual repository code.
 */

export interface DocVerificationContext {
  repoOwner: string
  repoName: string
  pageTitle: string
  pageCategory: string
  pageSlug: string
  markdown: string
  evidence?: Array<{
    file_path: string
    excerpt: string
    reason: string
  }>
}

/**
 * Generate a prompt for Claude Code to verify a documentation page
 */
export function generateVerificationPrompt(context: DocVerificationContext): string {
  const evidenceSection = context.evidence && context.evidence.length > 0
    ? `
## Evidence Provided (from auto-generation)

The following evidence was cited to support this documentation:

${context.evidence.map((e, i) => `
### Evidence ${i + 1}: ${e.file_path}
**Reason:** ${e.reason}
\`\`\`
${e.excerpt}
\`\`\`
`).join('\n')}
`
    : ''

  return `# Documentation Verification Task

You are reviewing auto-generated documentation for the repository **${context.repoOwner}/${context.repoName}**.

## Your Task

Please verify the following documentation page and provide corrections or improvements based on the actual code in this repository.

## Page Details
- **Title:** ${context.pageTitle}
- **Category:** ${context.pageCategory}
- **Slug:** ${context.pageSlug}

## Current Documentation Content

\`\`\`markdown
${context.markdown}
\`\`\`
${evidenceSection}
## Verification Instructions

1. **Read the actual source code** in this repository to verify each claim in the documentation
2. **Check if features described actually exist** - look for the components, functions, and APIs mentioned
3. **Identify any hallucinations** - claims that don't match the actual code
4. **Find missing features** - important functionality that wasn't documented
5. **Verify code excerpts** - ensure the evidence snippets match the actual files

## Expected Output Format

Please respond with a JSON object in this exact format:

\`\`\`json
{
  "verification_result": "accurate" | "needs_correction" | "mostly_wrong",
  "confidence_score": 0-100,
  "issues_found": [
    {
      "type": "hallucination" | "missing_feature" | "outdated" | "incorrect_evidence" | "minor_error",
      "description": "Description of the issue",
      "location": "Section or claim that has the issue",
      "suggested_fix": "How to fix it"
    }
  ],
  "corrected_markdown": "The full corrected markdown content (only if corrections needed)",
  "new_evidence": [
    {
      "file_path": "path/to/file",
      "excerpt": "actual code snippet",
      "reason": "why this supports the documentation"
    }
  ],
  "summary": "Brief summary of your findings"
}
\`\`\`

## Important Notes

- Be thorough - check every major claim against the actual code
- If something is correct, don't change it
- If you find issues, provide specific corrections
- Include new evidence from actual files you find
- The corrected_markdown should be complete and ready to use
`
}

/**
 * Generate a prompt for Claude Code to improve a specific section
 */
export function generateImprovementPrompt(
  context: DocVerificationContext,
  userFeedback: string
): string {
  return `# Documentation Improvement Task

You are improving auto-generated documentation for the repository **${context.repoOwner}/${context.repoName}**.

## User Feedback

The user has provided the following feedback about this documentation:

> ${userFeedback}

## Current Documentation

**Page:** ${context.pageTitle} (${context.pageCategory}/${context.pageSlug})

\`\`\`markdown
${context.markdown}
\`\`\`

## Your Task

1. **Investigate the user's feedback** by reading the actual code in the repository
2. **Verify if their concern is valid** - check the actual implementation
3. **Update the documentation** to address their feedback
4. **Add proper evidence** from the actual code files

## Expected Output Format

\`\`\`json
{
  "investigation_result": "feedback_valid" | "feedback_invalid" | "partially_valid",
  "findings": "What you found when investigating the code",
  "updated_markdown": "The complete updated markdown content",
  "evidence": [
    {
      "file_path": "path/to/file",
      "excerpt": "actual code snippet",
      "reason": "why this supports the documentation"
    }
  ]
}
\`\`\`
`
}

/**
 * Generate a prompt for bulk documentation review
 */
export function generateBulkReviewPrompt(
  repoOwner: string,
  repoName: string,
  pages: Array<{ title: string; category: string; slug: string; needs_review: boolean }>
): string {
  const pagesNeedingReview = pages.filter(p => p.needs_review)
  const pageList = pagesNeedingReview.map(p => `- ${p.category}/${p.slug}: "${p.title}"`).join('\n')

  return `# Bulk Documentation Review Task

You are reviewing auto-generated documentation for the repository **${repoOwner}/${repoName}**.

## Pages Flagged for Review

The following ${pagesNeedingReview.length} pages were flagged as needing review during auto-generation:

${pageList}

## Your Task

For each flagged page:

1. Read the actual source code to understand the feature/component
2. Determine if the documentation is accurate or needs correction
3. Provide corrections where needed

## Expected Output Format

\`\`\`json
{
  "reviews": [
    {
      "slug": "category/page-slug",
      "status": "verified" | "needs_correction",
      "issues": ["List of issues found"],
      "corrected_markdown": "Full corrected content if needed"
    }
  ],
  "summary": "Overall findings across all reviewed pages"
}
\`\`\`
`
}
