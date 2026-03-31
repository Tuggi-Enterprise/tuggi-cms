-- Migration: Add welcome_poi_id to core.clients
-- Purpose: Link a specific POI to a client for welcome audio in the download flow
-- Date: 2026-03-26

ALTER TABLE core.clients 
ADD COLUMN IF NOT EXISTS welcome_poi_id UUID REFERENCES core.attractions(id) ON DELETE SET NULL;

COMMENT ON COLUMN core.clients.welcome_poi_id IS 'Specific POI used to play welcome audio when the client QR code is scanned.';
