-- ===========================================
-- LaneShare Schema Introspection Setup
-- Run this in your Supabase project's SQL Editor
-- to enable full schema discovery
-- ===========================================

-- This creates views that expose schema metadata
-- through PostgREST (no schema cache issues!)

-- ===========================================
-- TABLES VIEW
-- ===========================================
CREATE OR REPLACE VIEW public._laneshare_tables AS
SELECT
  t.table_schema,
  t.table_name,
  t.table_type
FROM information_schema.tables t
WHERE t.table_schema NOT IN (
  'pg_catalog', 'information_schema', 'pg_toast', 'extensions',
  'graphql', 'graphql_public', 'net', 'pgsodium', 'pgsodium_masks',
  'realtime', 'storage', 'supabase_functions', 'supabase_migrations',
  'vault', '_realtime'
)
AND t.table_type = 'BASE TABLE'
ORDER BY t.table_schema, t.table_name;

-- ===========================================
-- COLUMNS VIEW
-- ===========================================
CREATE OR REPLACE VIEW public._laneshare_columns AS
SELECT
  c.table_schema,
  c.table_name,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default,
  c.ordinal_position
FROM information_schema.columns c
WHERE c.table_schema NOT IN (
  'pg_catalog', 'information_schema', 'pg_toast', 'extensions',
  'graphql', 'graphql_public', 'net', 'pgsodium', 'pgsodium_masks',
  'realtime', 'storage', 'supabase_functions', 'supabase_migrations',
  'vault', '_realtime'
)
ORDER BY c.table_schema, c.table_name, c.ordinal_position;

-- ===========================================
-- PRIMARY KEYS VIEW
-- ===========================================
CREATE OR REPLACE VIEW public._laneshare_primary_keys AS
SELECT
  kcu.table_schema,
  kcu.table_name,
  kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
WHERE tc.constraint_type = 'PRIMARY KEY'
  AND tc.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'extensions')
ORDER BY kcu.table_schema, kcu.table_name, kcu.ordinal_position;

-- ===========================================
-- FOREIGN KEYS VIEW
-- ===========================================
CREATE OR REPLACE VIEW public._laneshare_foreign_keys AS
SELECT
  tc.table_schema,
  tc.table_name,
  kcu.column_name,
  ccu.table_schema AS foreign_table_schema,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'extensions');

-- ===========================================
-- RLS POLICIES VIEW
-- ===========================================
CREATE OR REPLACE VIEW public._laneshare_policies AS
SELECT
  pol.polname AS policy_name,
  nsp.nspname AS schema_name,
  cls.relname AS table_name,
  CASE pol.polcmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
    WHEN '*' THEN 'ALL'
  END AS command,
  pg_get_expr(pol.polqual, pol.polrelid, true) AS definition,
  pg_get_expr(pol.polwithcheck, pol.polrelid, true) AS with_check,
  ARRAY(
    SELECT rolname
    FROM pg_roles
    WHERE oid = ANY(pol.polroles)
  ) AS roles
FROM pg_policy pol
JOIN pg_class cls ON pol.polrelid = cls.oid
JOIN pg_namespace nsp ON cls.relnamespace = nsp.oid
WHERE nsp.nspname NOT IN (
  'pg_catalog', 'information_schema', 'pg_toast', 'extensions',
  'graphql', 'graphql_public', 'net', 'pgsodium', 'pgsodium_masks',
  'realtime', 'storage', 'supabase_functions', 'supabase_migrations',
  'vault', '_realtime'
)
ORDER BY nsp.nspname, cls.relname, pol.polname;

-- ===========================================
-- FUNCTIONS VIEW
-- ===========================================
CREATE OR REPLACE VIEW public._laneshare_functions AS
SELECT
  p.proname AS function_name,
  n.nspname AS schema_name,
  l.lanname AS language,
  pg_get_function_result(p.oid) AS return_type,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  CASE
    WHEN p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype THEN true
    ELSE false
  END AS is_trigger
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
JOIN pg_language l ON p.prolang = l.oid
WHERE n.nspname NOT IN (
  'pg_catalog', 'information_schema', 'pg_toast', 'extensions',
  'graphql', 'graphql_public', 'net', 'pgsodium', 'pgsodium_masks',
  'realtime', 'supabase_functions', 'supabase_migrations', 'vault', '_realtime'
)
AND p.prokind = 'f'
ORDER BY n.nspname, p.proname
LIMIT 500;

-- ===========================================
-- TRIGGERS VIEW
-- ===========================================
CREATE OR REPLACE VIEW public._laneshare_triggers AS
SELECT
  t.tgname AS trigger_name,
  n.nspname AS schema_name,
  c.relname AS table_name,
  p.proname AS function_name,
  CASE t.tgtype & 66
    WHEN 2 THEN 'BEFORE'
    WHEN 64 THEN 'INSTEAD OF'
    ELSE 'AFTER'
  END AS timing,
  CASE t.tgtype & 28
    WHEN 4 THEN 'INSERT'
    WHEN 8 THEN 'DELETE'
    WHEN 16 THEN 'UPDATE'
    WHEN 20 THEN 'INSERT OR UPDATE'
    WHEN 12 THEN 'INSERT OR DELETE'
    WHEN 24 THEN 'UPDATE OR DELETE'
    WHEN 28 THEN 'INSERT OR UPDATE OR DELETE'
  END AS event
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE NOT t.tgisinternal
  AND n.nspname NOT IN (
    'pg_catalog', 'information_schema', 'pg_toast', 'extensions',
    'graphql', 'graphql_public', 'net', 'pgsodium', 'pgsodium_masks',
    'realtime', 'supabase_functions', 'supabase_migrations', 'vault', '_realtime'
  )
ORDER BY n.nspname, c.relname, t.tgname;

-- ===========================================
-- GRANT ACCESS TO SERVICE ROLE
-- ===========================================
GRANT SELECT ON public._laneshare_tables TO service_role;
GRANT SELECT ON public._laneshare_columns TO service_role;
GRANT SELECT ON public._laneshare_primary_keys TO service_role;
GRANT SELECT ON public._laneshare_foreign_keys TO service_role;
GRANT SELECT ON public._laneshare_policies TO service_role;
GRANT SELECT ON public._laneshare_functions TO service_role;
GRANT SELECT ON public._laneshare_triggers TO service_role;

-- Revoke from anon and authenticated for security
REVOKE SELECT ON public._laneshare_tables FROM anon, authenticated;
REVOKE SELECT ON public._laneshare_columns FROM anon, authenticated;
REVOKE SELECT ON public._laneshare_primary_keys FROM anon, authenticated;
REVOKE SELECT ON public._laneshare_foreign_keys FROM anon, authenticated;
REVOKE SELECT ON public._laneshare_policies FROM anon, authenticated;
REVOKE SELECT ON public._laneshare_functions FROM anon, authenticated;
REVOKE SELECT ON public._laneshare_triggers FROM anon, authenticated;

-- ===========================================
-- DONE!
-- ===========================================
-- Your Supabase project is now ready for
-- LaneShare schema introspection.
-- Go back to LaneShare and click "Sync Now"
