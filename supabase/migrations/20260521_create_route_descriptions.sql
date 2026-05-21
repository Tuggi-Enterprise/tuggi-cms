-- Migration: Custom Route Descriptions (i18n)
-- Purpose: Multi-language support for custom route names, descriptions, and audio.
-- Follows the same pattern as core.attraction_descriptions (SSOT).
-- Date: 2026-05-21

-- ============================================================
-- 1. MAIN TABLE: custom_route_descriptions
-- ============================================================

CREATE TABLE IF NOT EXISTS core.custom_route_descriptions (
  id              UUID        NOT NULL DEFAULT gen_random_uuid(),
  route_id        UUID        NOT NULL,
  language        VARCHAR(10) NOT NULL,  -- 'pt-br' | 'en-us' | 'fr-fr' | 'de-de' etc.
  gender          VARCHAR(10) NOT NULL DEFAULT 'male',  -- 'male' | 'female'
  name            VARCHAR(500),          -- Route name translated
  description     TEXT,                  -- Route description translated
                                         -- '[GENERATING]' = optimistic lock held by EF
  audio_url       TEXT,                  -- TTS audio URL for the description (nullable = no audio yet)
  status          TEXT        NOT NULL DEFAULT 'pending',
                                         -- 'pending' | 'generating' | 'ready' | 'failed'
  -- Manual edit tracking (admin can override AI translation)
  manually_edited     BOOLEAN     DEFAULT false,
  manually_edited_at  TIMESTAMPTZ,
  manually_edited_by  UUID,              -- FK to core.cms_users (soft reference, no cascade)
  -- Audit
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT custom_route_descriptions_pkey PRIMARY KEY (id),
  CONSTRAINT custom_route_descriptions_route_fk
    FOREIGN KEY (route_id) REFERENCES core.custom_routes(id) ON DELETE CASCADE,
  CONSTRAINT custom_route_descriptions_status_check
    CHECK (status IN ('pending', 'generating', 'ready', 'failed')),
  CONSTRAINT custom_route_descriptions_gender_check
    CHECK (gender IN ('male', 'female')),
  -- (route_id, language, gender) — mirrors attraction_descriptions unique constraint
  CONSTRAINT custom_route_descriptions_unique
    UNIQUE (route_id, language, gender)
) TABLESPACE pg_default;

-- ============================================================
-- 2. INDEXES
-- ============================================================

-- Primary lookup: route + language (the most common query pattern)
CREATE INDEX IF NOT EXISTS idx_route_descriptions_route_lang
  ON core.custom_route_descriptions (route_id, language)
  TABLESPACE pg_default;

-- Find all ready translations for a language (for monitoring/reporting)
CREATE INDEX IF NOT EXISTS idx_route_descriptions_status
  ON core.custom_route_descriptions (language, status)
  TABLESPACE pg_default;

-- ============================================================
-- 3. AUTO-UPDATE TIMESTAMP TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION core.update_route_descriptions_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_route_descriptions_timestamp
  BEFORE UPDATE ON core.custom_route_descriptions
  FOR EACH ROW
  EXECUTE FUNCTION core.update_route_descriptions_timestamp();

-- ============================================================
-- 4. COMMENTS
-- ============================================================

COMMENT ON TABLE core.custom_route_descriptions IS
  'Multi-language translations for custom route names and descriptions. '
  'Generated on-demand by the generate-translated-audio Edge Function (route mode). '
  'Follows the same pattern as core.attraction_descriptions.';

COMMENT ON COLUMN core.custom_route_descriptions.status IS
  'pending = not started; generating = EF lock held; ready = complete; failed = EF error';

COMMENT ON COLUMN core.custom_route_descriptions.manually_edited IS
  'true when admin manually overrode the AI-generated text. '
  'The EF warns before overwriting manually-edited content.';
