-- Migration: Add gender column to custom_route_descriptions
-- The table was created without gender; this adds it to match the
-- attraction_descriptions pattern (route_id, language, gender) unique.
-- Date: 2026-05-21

-- 1. Add gender column (safe — IF NOT EXISTS)
ALTER TABLE core.custom_route_descriptions
  ADD COLUMN IF NOT EXISTS gender VARCHAR(10) NOT NULL DEFAULT 'male';

-- 2. Add check constraint for gender values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'custom_route_descriptions_gender_check'
      AND conrelid = 'core.custom_route_descriptions'::regclass
  ) THEN
    ALTER TABLE core.custom_route_descriptions
      ADD CONSTRAINT custom_route_descriptions_gender_check
      CHECK (gender IN ('male', 'female'));
  END IF;
END $$;

-- 3. Drop old unique constraint (route_id, language) and replace with (route_id, language, gender)
ALTER TABLE core.custom_route_descriptions
  DROP CONSTRAINT IF EXISTS custom_route_descriptions_unique;

ALTER TABLE core.custom_route_descriptions
  ADD CONSTRAINT custom_route_descriptions_unique
  UNIQUE (route_id, language, gender);
