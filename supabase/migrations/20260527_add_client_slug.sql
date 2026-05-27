-- Migration: Add slug to core.clients
-- Purpose: URL-friendly identifier for the public partner download page (/d/<slug>),
--          replacing the long /download?ID=<uuid> link. Auto-generated from
--          company_name on creation, editable by an admin, kept unique.
-- Date: 2026-05-27

-- ============================================
-- 1. ADD COLUMN (nullable first so backfill can run before the unique index)
-- ============================================
ALTER TABLE core.clients
  ADD COLUMN IF NOT EXISTS slug VARCHAR(255);

COMMENT ON COLUMN core.clients.slug IS
  'URL-friendly identifier for the /d/<slug> partner download page. Auto-generated from company_name, editable by admin, unique.';

-- ============================================
-- 2. SLUGIFY HELPER
-- ============================================
-- Lowercases, folds common pt/es/en accents to ASCII (self-contained, no extension),
-- turns every run of non-alphanumerics into a single hyphen, and trims edge hyphens.
CREATE OR REPLACE FUNCTION core.slugify(input TEXT)
RETURNS TEXT AS $$
  SELECT trim(BOTH '-' FROM
    regexp_replace(
      translate(
        lower(coalesce(input, '')),
        'àáâãäåèéêëìíîïòóôõöùúûüçñýÿ',
        'aaaaaaeeeeiiiiooooouuuucnyy'
      ),
      '[^a-z0-9]+', '-', 'g'
    )
  );
$$ LANGUAGE sql IMMUTABLE;

-- ============================================
-- 3. UNIQUE-SLUG ALLOCATOR (used for auto-generation + backfill)
-- ============================================
-- Slugifies `base`, then appends -2, -3, ... until it finds a value not used by
-- another client. SECURITY DEFINER so it can see every row regardless of RLS.
CREATE OR REPLACE FUNCTION core.next_unique_client_slug(base TEXT, self_id UUID DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
DECLARE
  root TEXT;
  candidate TEXT;
  n INT := 1;
BEGIN
  root := core.slugify(base);
  IF root IS NULL OR root = '' THEN
    root := 'partner';
  END IF;
  candidate := root;
  WHILE EXISTS (
    SELECT 1 FROM core.clients
    WHERE slug = candidate AND (self_id IS NULL OR id <> self_id)
  ) LOOP
    n := n + 1;
    candidate := root || '-' || n;
  END LOOP;
  RETURN candidate;
END;
$$;

-- ============================================
-- 4. BACKFILL EXISTING ROWS
-- ============================================
-- Oldest rows first so they keep the clean slug; prefer company_name, fall back to name.
-- Temporarily disable the updated_at trigger so the backfill does not bump timestamps.
ALTER TABLE core.clients DISABLE TRIGGER trigger_update_clients_timestamp;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, company_name, name
    FROM core.clients
    WHERE slug IS NULL
    ORDER BY created_at ASC
  LOOP
    UPDATE core.clients
      SET slug = core.next_unique_client_slug(COALESCE(NULLIF(r.company_name, ''), r.name), r.id)
      WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE core.clients ENABLE TRIGGER trigger_update_clients_timestamp;

-- ============================================
-- 5. UNIQUE INDEX (after backfill, so no nulls/dupes block it)
-- ============================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_slug ON core.clients(slug);

-- ============================================
-- 6. SAFETY-NET TRIGGER
-- ============================================
-- Guarantees every insert/update ends with a valid, normalized slug:
--   - INSERT with no slug      -> auto-generate from company_name/name (deduped)
--   - INSERT/UPDATE with slug  -> normalize only; the unique index rejects collisions
--                                 (the API maps that to HTTP 409)
--   - UPDATE clearing the slug -> keep the previous one (never break existing links)
CREATE OR REPLACE FUNCTION core.ensure_client_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
      NEW.slug := core.next_unique_client_slug(COALESCE(NULLIF(NEW.company_name, ''), NEW.name), NULL);
    ELSE
      NEW.slug := core.slugify(NEW.slug);
      IF NEW.slug = '' THEN
        NEW.slug := core.next_unique_client_slug(COALESCE(NULLIF(NEW.company_name, ''), NEW.name), NULL);
      END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
      NEW.slug := OLD.slug;
    ELSE
      NEW.slug := core.slugify(NEW.slug);
      IF NEW.slug = '' THEN
        NEW.slug := OLD.slug;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_ensure_client_slug ON core.clients;
CREATE TRIGGER trigger_ensure_client_slug
  BEFORE INSERT OR UPDATE ON core.clients
  FOR EACH ROW
  EXECUTE FUNCTION core.ensure_client_slug();
