-- ===========================================
-- OPENAPI/SWAGGER CONNECTED SERVICE
-- Adds support for connecting OpenAPI/Swagger spec URLs
-- ===========================================

-- ===========================================
-- ADD 'SERVICE' TO EVIDENCE SOURCE TYPE
-- Allows referencing service_assets as grounding evidence
-- ===========================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'SERVICE'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'evidence_source_type')
  ) THEN
    ALTER TYPE evidence_source_type ADD VALUE 'SERVICE';
  END IF;
END$$;

-- ===========================================
-- ADD 'WARNING' TO SERVICE CONNECTION STATUS
-- For partial sync successes
-- ===========================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'WARNING'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'service_connection_status')
  ) THEN
    ALTER TYPE service_connection_status ADD VALUE 'WARNING';
  END IF;
END$$;

-- ===========================================
-- ADD 'WARNING' TO SERVICE SYNC STATUS
-- For partial sync successes
-- ===========================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'WARNING'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'service_sync_status')
  ) THEN
    ALTER TYPE service_sync_status ADD VALUE 'WARNING';
  END IF;
END$$;

-- ===========================================
-- ADD 'apis' TO DOC CATEGORY
-- For API documentation pages
-- ===========================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'apis'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'doc_category')
  ) THEN
    ALTER TYPE doc_category ADD VALUE 'apis';
  END IF;
END$$;

-- ===========================================
-- INDEXES FOR OPENAPI ASSET LOOKUPS
-- ===========================================

-- Index for filtering by service type (for openapi endpoints lookup)
CREATE INDEX IF NOT EXISTS service_assets_service_type_idx
  ON public.service_assets (service, asset_type);

-- Index for project-level service asset lookups
CREATE INDEX IF NOT EXISTS service_assets_project_service_idx
  ON public.service_assets (project_id, service);

-- ===========================================
-- HELPER FUNCTION: Get endpoint assets for a project
-- ===========================================
CREATE OR REPLACE FUNCTION public.get_openapi_endpoints(
  p_project_id UUID,
  p_search_query TEXT DEFAULT NULL,
  p_tag TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  connection_id UUID,
  asset_key TEXT,
  name TEXT,
  data_json JSONB,
  api_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    sa.id,
    sa.connection_id,
    sa.asset_key,
    sa.name,
    sa.data_json,
    psc.display_name AS api_name
  FROM public.service_assets sa
  JOIN public.project_service_connections psc ON sa.connection_id = psc.id
  WHERE sa.project_id = p_project_id
    AND sa.service = 'openapi'
    AND sa.asset_type = 'endpoint'
    AND psc.status IN ('CONNECTED', 'WARNING')
    AND (
      p_search_query IS NULL
      OR sa.name ILIKE '%' || p_search_query || '%'
      OR (sa.data_json->>'path') ILIKE '%' || p_search_query || '%'
      OR (sa.data_json->>'operationId') ILIKE '%' || p_search_query || '%'
      OR (sa.data_json->>'summary') ILIKE '%' || p_search_query || '%'
    )
    AND (
      p_tag IS NULL
      OR sa.data_json->'tags' ? p_tag
    )
  ORDER BY sa.data_json->>'path', sa.data_json->>'method'
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
