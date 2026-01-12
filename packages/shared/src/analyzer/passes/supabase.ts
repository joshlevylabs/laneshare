// Pass 4: Supabase Model Analysis
// Parses SQL migrations to extract tables, functions, and RLS policies

import type {
  AnalysisContext,
  AnalyzerPassResult,
  TableNode,
  FunctionNode,
  AuthNode,
  StorageNode,
  Evidence,
  Confidence,
} from '../../types/architecture'
import { generateNodeId, generateEvidenceId, generateEdgeId } from '../utils/ids'

interface Column {
  name: string
  type: string
  nullable: boolean
  defaultValue?: string
  isPrimaryKey?: boolean
  isForeignKey?: boolean
  references?: { table: string; column: string }
}

interface Table {
  name: string
  schema: string
  columns: Column[]
  hasRls: boolean
  policies: string[]
}

interface DbFunction {
  name: string
  schema: string
  language: string
  securityDefiner: boolean
  returns: string
}

/**
 * Analyze Supabase schema from migrations
 * Creates table, function, auth, and storage nodes
 */
export async function analyzeSupabase(
  context: AnalysisContext
): Promise<AnalyzerPassResult> {
  const nodes: AnalyzerPassResult['nodes'] = []
  const edges: AnalyzerPassResult['edges'] = []
  const evidence: Evidence[] = []

  // Collect all migration content
  let allMigrationContent = ''
  const migrationFiles: Array<{ path: string; content: string }> = []

  for (const repo of context.repos) {
    const migrations = repo.files.filter((f) =>
      f.path.match(/supabase\/migrations\/.*\.sql$/)
    )

    for (const migration of migrations) {
      const content = context.existingChunks.get(migration.path)
      if (content) {
        allMigrationContent += content + '\n'
        migrationFiles.push({ path: migration.path, content })
      }
    }
  }

  if (!allMigrationContent) {
    return { nodes, edges, evidence }
  }

  // Parse tables from CREATE TABLE statements
  const tables = parseCreateTableStatements(allMigrationContent)

  // Parse RLS policies
  const policies = parseRlsPolicies(allMigrationContent)

  // Parse functions
  const functions = parseFunctions(allMigrationContent)

  // Create table nodes
  for (const table of tables) {
    // Apply RLS info
    const tablePolicies = policies.filter((p) => p.table === table.name)
    table.hasRls = allMigrationContent.includes(
      `ALTER TABLE public.${table.name} ENABLE ROW LEVEL SECURITY`
    ) || allMigrationContent.includes(
      `ALTER TABLE ${table.schema}.${table.name} ENABLE ROW LEVEL SECURITY`
    )
    table.policies = tablePolicies.map((p) => p.name)

    const nodeId = generateNodeId('table', 'supabase', table.name)
    const tableNode: TableNode = {
      id: nodeId,
      type: 'table',
      label: table.name,
      metadata: {
        schema: table.schema,
        columns: table.columns.map((c) => ({
          name: c.name,
          type: c.type,
          nullable: c.nullable,
        })),
        hasRls: table.hasRls,
        policies: table.policies,
        migrationFile: findMigrationForTable(table.name, migrationFiles)?.path,
      },
    }
    nodes.push(tableNode)

    // Add evidence for table definition
    const migrationFile = findMigrationForTable(table.name, migrationFiles)
    if (migrationFile) {
      const lineNum = findLineNumber(migrationFile.content, `CREATE TABLE.*${table.name}`)
      evidence.push({
        id: generateEvidenceId('DB_TABLE', nodeId, migrationFile.path, lineNum),
        kind: 'DB_TABLE',
        nodeId,
        filePath: migrationFile.path,
        lineStart: lineNum,
        symbol: table.name,
        excerpt: extractTableExcerpt(migrationFile.content, table.name),
        confidence: 'high',
        metadata: { columns: table.columns.length, hasRls: table.hasRls },
      })
    }

    // Add evidence for RLS policies
    for (const policy of tablePolicies) {
      const policyFile = findMigrationForPolicy(policy.name, migrationFiles)
      if (policyFile) {
        evidence.push({
          id: generateEvidenceId('RLS_POLICY', nodeId, policyFile.path),
          kind: 'RLS_POLICY',
          nodeId,
          filePath: policyFile.path,
          symbol: policy.name,
          excerpt: policy.excerpt,
          confidence: 'high',
          metadata: { operation: policy.operation },
        })
      }
    }

    // Create edges for foreign keys
    for (const col of table.columns) {
      if (col.isForeignKey && col.references) {
        const targetNodeId = generateNodeId('table', 'supabase', col.references.table)
        edges.push({
          id: generateEdgeId(nodeId, targetNodeId, 'reads'),
          source: nodeId,
          target: targetNodeId,
          type: 'reads',
          label: `FK: ${col.name}`,
          confidence: 'high',
          evidenceIds: [],
          metadata: { column: col.name, referencedColumn: col.references.column },
        })
      }
    }
  }

  // Create function nodes
  for (const func of functions) {
    const nodeId = generateNodeId('function', 'supabase', func.name)
    const funcNode: FunctionNode = {
      id: nodeId,
      type: 'function',
      label: func.name,
      metadata: {
        schema: func.schema,
        language: func.language,
        securityDefiner: func.securityDefiner,
        migrationFile: findMigrationForFunction(func.name, migrationFiles)?.path,
      },
    }
    nodes.push(funcNode)

    // Add evidence
    const migrationFile = findMigrationForFunction(func.name, migrationFiles)
    if (migrationFile) {
      const lineNum = findLineNumber(migrationFile.content, `CREATE.*FUNCTION.*${func.name}`)
      evidence.push({
        id: generateEvidenceId('DB_FUNCTION', nodeId, migrationFile.path, lineNum),
        kind: 'DB_FUNCTION',
        nodeId,
        filePath: migrationFile.path,
        lineStart: lineNum,
        symbol: func.name,
        excerpt: extractFunctionExcerpt(migrationFile.content, func.name),
        confidence: 'high',
        metadata: { language: func.language, securityDefiner: func.securityDefiner },
      })
    }
  }

  // Create Auth node
  const hasAuth = allMigrationContent.includes('auth.users') ||
    allMigrationContent.includes('supabase.auth')
  if (hasAuth || tables.some((t) => t.name === 'profiles')) {
    const authNodeId = generateNodeId('auth', 'supabase')
    const authNode: AuthNode = {
      id: authNodeId,
      type: 'auth',
      label: 'Supabase Auth',
      metadata: {
        provider: 'supabase',
        providers: detectAuthProviders(allMigrationContent),
        hasRoleSystem: tables.some((t) =>
          t.columns.some((c) => c.name === 'role' || c.type.includes('role'))
        ),
      },
    }
    nodes.push(authNode)

    // Link auth to profiles table if exists
    const profilesNode = nodes.find((n) => n.type === 'table' && n.label === 'profiles')
    if (profilesNode) {
      edges.push({
        id: generateEdgeId(authNodeId, profilesNode.id, 'writes'),
        source: authNodeId,
        target: profilesNode.id,
        type: 'writes',
        label: 'user profile',
        confidence: 'high',
        evidenceIds: [],
        metadata: {},
      })
    }
  }

  // Detect Storage usage
  if (allMigrationContent.includes('storage.buckets') ||
    allMigrationContent.includes('storage.objects')) {
    const storageNodeId = generateNodeId('storage', 'supabase')
    const storageNode: StorageNode = {
      id: storageNodeId,
      type: 'storage',
      label: 'Supabase Storage',
      metadata: {
        provider: 'supabase',
        isPublic: allMigrationContent.includes('public = true'),
      },
    }
    nodes.push(storageNode)
  }

  return { nodes, edges, evidence }
}

function parseCreateTableStatements(sql: string): Table[] {
  const tables: Table[] = []

  // Match CREATE TABLE statements
  const tableRegex = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:(\w+)\.)?(\w+)\s*\(([\s\S]*?)\);/gi
  let match

  while ((match = tableRegex.exec(sql)) !== null) {
    const schema = match[1] || 'public'
    const tableName = match[2]
    const columnsDef = match[3]

    if (tableName.startsWith('_') || schema === 'auth') {
      continue // Skip internal tables
    }

    const columns = parseColumns(columnsDef)

    tables.push({
      name: tableName,
      schema,
      columns,
      hasRls: false,
      policies: [],
    })
  }

  return tables
}

function parseColumns(columnsDef: string): Column[] {
  const columns: Column[] = []

  // Split by lines and filter
  const lines = columnsDef.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('--') && !l.startsWith('CONSTRAINT') &&
      !l.startsWith('PRIMARY KEY') && !l.startsWith('UNIQUE') &&
      !l.startsWith('FOREIGN KEY') && !l.startsWith('CHECK'))

  for (const line of lines) {
    // Parse column: name TYPE [NOT NULL] [DEFAULT ...] [REFERENCES ...]
    const colMatch = line.match(/^(\w+)\s+([A-Z]+(?:\([^)]+\))?(?:\[\])?)/i)
    if (!colMatch) continue

    const name = colMatch[1]
    const type = colMatch[2]

    // Skip common non-column keywords
    if (['PRIMARY', 'FOREIGN', 'UNIQUE', 'INDEX', 'CONSTRAINT'].includes(name.toUpperCase())) {
      continue
    }

    const nullable = !line.toUpperCase().includes('NOT NULL')
    const isPrimaryKey = line.toUpperCase().includes('PRIMARY KEY')

    // Check for REFERENCES
    const refMatch = line.match(/REFERENCES\s+(?:(\w+)\.)?(\w+)\s*\(\s*(\w+)\s*\)/i)
    const isForeignKey = !!refMatch

    columns.push({
      name,
      type,
      nullable,
      isPrimaryKey,
      isForeignKey,
      references: refMatch
        ? { table: refMatch[2], column: refMatch[3] }
        : undefined,
    })
  }

  return columns
}

interface Policy {
  name: string
  table: string
  operation: string
  excerpt: string
}

function parseRlsPolicies(sql: string): Policy[] {
  const policies: Policy[] = []

  // Match CREATE POLICY statements
  const policyRegex = /CREATE POLICY\s+"([^"]+)"\s+ON\s+(?:(\w+)\.)?(\w+)\s+(?:AS\s+\w+\s+)?(?:FOR\s+(\w+)\s+)?/gi
  let match

  while ((match = policyRegex.exec(sql)) !== null) {
    const name = match[1]
    const table = match[3]
    const operation = match[4] || 'ALL'

    // Extract excerpt (up to next semicolon)
    const startPos = match.index
    const endPos = sql.indexOf(';', startPos)
    const excerpt = sql.slice(startPos, endPos + 1).slice(0, 300)

    policies.push({
      name,
      table,
      operation,
      excerpt,
    })
  }

  return policies
}

function parseFunctions(sql: string): DbFunction[] {
  const functions: DbFunction[] = []

  // Match CREATE FUNCTION statements
  const funcRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:(\w+)\.)?(\w+)\s*\([^)]*\)\s*RETURNS\s+(\w+(?:\s+\w+)?)/gi
  let match

  while ((match = funcRegex.exec(sql)) !== null) {
    const schema = match[1] || 'public'
    const name = match[2]
    const returns = match[3]

    // Find the full function definition
    const startPos = match.index
    const dollarPos = sql.indexOf('$$', startPos)
    const endDollarPos = dollarPos > 0 ? sql.indexOf('$$', dollarPos + 2) : -1
    const funcEnd = endDollarPos > 0 ? sql.indexOf(';', endDollarPos) : sql.indexOf(';', startPos)

    const funcDef = sql.slice(startPos, funcEnd + 1)

    // Detect language
    const langMatch = funcDef.match(/LANGUAGE\s+(\w+)/i)
    const language = langMatch ? langMatch[1] : 'sql'

    const securityDefiner = funcDef.toUpperCase().includes('SECURITY DEFINER')

    functions.push({
      name,
      schema,
      language,
      securityDefiner,
      returns,
    })
  }

  return functions
}

function detectAuthProviders(sql: string): string[] {
  const providers: string[] = []

  if (sql.includes('github') || sql.includes('GitHub')) providers.push('github')
  if (sql.includes('google') || sql.includes('Google')) providers.push('google')
  if (sql.includes('email') || sql.includes('password')) providers.push('email')

  return providers.length > 0 ? providers : ['email']
}

function findMigrationForTable(
  tableName: string,
  migrationFiles: Array<{ path: string; content: string }>
): { path: string; content: string } | undefined {
  return migrationFiles.find((f) =>
    f.content.match(new RegExp(`CREATE TABLE.*\\b${tableName}\\b`, 'i'))
  )
}

function findMigrationForPolicy(
  policyName: string,
  migrationFiles: Array<{ path: string; content: string }>
): { path: string; content: string } | undefined {
  return migrationFiles.find((f) =>
    f.content.includes(`"${policyName}"`)
  )
}

function findMigrationForFunction(
  funcName: string,
  migrationFiles: Array<{ path: string; content: string }>
): { path: string; content: string } | undefined {
  return migrationFiles.find((f) =>
    f.content.match(new RegExp(`CREATE.*FUNCTION.*\\b${funcName}\\b`, 'i'))
  )
}

function findLineNumber(content: string, pattern: string): number {
  const lines = content.split('\n')
  const regex = new RegExp(pattern, 'i')

  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      return i + 1
    }
  }

  return 1
}

function extractTableExcerpt(content: string, tableName: string): string {
  const regex = new RegExp(`(CREATE TABLE[^;]*${tableName}[^;]*;)`, 'is')
  const match = content.match(regex)

  if (match) {
    return match[1].slice(0, 500)
  }

  return ''
}

function extractFunctionExcerpt(content: string, funcName: string): string {
  const startMatch = content.match(new RegExp(`CREATE.*FUNCTION.*${funcName}`, 'i'))
  if (!startMatch) return ''

  const startPos = startMatch.index!
  const excerpt = content.slice(startPos, startPos + 400)

  return excerpt + (excerpt.length >= 400 ? '...' : '')
}
