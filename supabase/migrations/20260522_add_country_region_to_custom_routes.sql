-- Migration: Add country and region columns to custom_routes
-- Date: 2026-05-22
-- Purpose: Enable sidebar filtering by country and region on the routes management page

ALTER TABLE core.custom_routes
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS region  TEXT;

-- Index for country filter (partial — skips nulls for efficiency)
CREATE INDEX IF NOT EXISTS idx_custom_routes_country
  ON core.custom_routes(country)
  WHERE country IS NOT NULL;

-- Populate existing Lisbon routes
UPDATE core.custom_routes
SET country = 'Portugal', region = 'Lisboa'
WHERE name IN (
  'Descubra Lisboa Histórica',
  'Grand Tour de Lisboa — De Oriente a Belém',
  'Elétrico 28 — Pelos Morros de Lisboa',
  'Outro Lado do Tejo — Cristo Rei e Almada'
);

-- Sintra is in the Lisboa district (but a different municipality)
UPDATE core.custom_routes
SET country = 'Portugal', region = 'Sintra'
WHERE name = 'Sintra — Palácios, Castelos e Mistério';

-- Also handle any other Portuguese routes without region set
UPDATE core.custom_routes
SET country = 'Portugal'
WHERE country IS NULL
  AND (
    region IS NOT NULL
    OR name ILIKE '%lisboa%'
    OR name ILIKE '%porto%'
    OR name ILIKE '%sintra%'
    OR name ILIKE '%algarve%'
  );
