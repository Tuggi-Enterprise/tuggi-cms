-- Migration: Create Unified POI Exclusion & Recovery System
-- Author: Antigravity
-- Date: 2026-04-27

-- 1. Create the new exclusions table in core schema
CREATE TABLE IF NOT EXISTS core.poi_exclusions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_id UUID,
    original_schema TEXT NOT NULL CHECK (original_schema IN ('core', 'homolog')),
    
    -- Identification
    osm_id BIGINT,
    osm_type TEXT,
    
    -- Basic info for display and identification
    name TEXT,
    city TEXT,
    state TEXT,
    country TEXT,
    category TEXT,
    
    -- Location for recovery
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    
    -- Exclusion logic
    reason TEXT DEFAULT 'user_deleted', -- 'user_deleted', 'duplicate', 'garbage'
    status TEXT NOT NULL DEFAULT 'trash' CHECK (status IN ('trash', 'blacklisted')),
    
    -- Snapshot for full recovery (Core only)
    data_snapshot JSONB,
    
    -- Audit
    excluded_by UUID REFERENCES core.cms_users(id) ON DELETE SET NULL,
    excluded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create indexes
CREATE INDEX idx_poi_exclusions_osm ON core.poi_exclusions(osm_id, osm_type) WHERE osm_id IS NOT NULL;
CREATE INDEX idx_poi_exclusions_name_city ON core.poi_exclusions(name, city);
CREATE INDEX idx_poi_exclusions_status ON core.poi_exclusions(status);
CREATE INDEX idx_poi_exclusions_original_id ON core.poi_exclusions(original_id);

-- 3. Move data from homolog.pois_blacklist if it exists
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'homolog' AND table_name = 'pois_blacklist') THEN
        INSERT INTO core.poi_exclusions (
            original_id,
            original_schema,
            osm_id,
            osm_type,
            name,
            city,
            state,
            country,
            category,
            reason,
            status,
            excluded_at,
            created_at
        )
        SELECT 
            poi_uuid_id,
            'homolog',
            osm_id,
            osm_type,
            name,
            city,
            state,
            country,
            category,
            reason,
            'blacklisted', -- Existing blacklist items are considered garbage
            excluded_at,
            created_at
        FROM homolog.pois_blacklist;
        
        -- Comment out or drop the old table after verification in a separate step if desired
        -- DROP TABLE homolog.pois_blacklist;
    END IF;
END $$;

-- 4. RPC to Delete as Garbage (Admin only action)
CREATE OR REPLACE FUNCTION core.delete_poi_as_garbage(
    p_poi_id UUID,
    p_admin_id UUID
) RETURNS VOID AS $$
DECLARE
    v_poi RECORD;
    v_coord RECORD;
BEGIN
    -- Get POI data
    SELECT * INTO v_poi FROM core.attractions WHERE id = p_poi_id;
    IF NOT FOUND THEN
        RETURN; -- Skip if already gone
    END IF;

    -- Get Coordinates
    SELECT * INTO v_coord FROM core.attraction_coordinate WHERE attraction_id = p_poi_id LIMIT 1;

    -- Insert into exclusions as blacklisted
    INSERT INTO core.poi_exclusions (
        original_id,
        original_schema,
        osm_id,
        osm_type,
        name,
        city,
        state,
        country,
        category,
        latitude,
        longitude,
        reason,
        status,
        excluded_by
    ) VALUES (
        v_poi.id,
        'core',
        v_poi.osm_id,
        v_poi.osm_type,
        v_poi.name,
        v_poi.city,
        v_poi.state,
        v_poi.country,
        v_poi.category,
        v_coord.latitude,
        v_coord.longitude,
        'garbage',
        'blacklisted',
        p_admin_id
    )
    ON CONFLICT (osm_id, osm_type) WHERE osm_id IS NOT NULL DO UPDATE SET
        status = 'blacklisted',
        reason = 'garbage',
        excluded_at = NOW();

    -- Delete from core (Triggers will handle cascade)
    DELETE FROM core.attractions WHERE id = p_poi_id;
END;
$$ LANGUAGE plpgsql;

-- 4b. Bulk RPC to Delete as Garbage
CREATE OR REPLACE FUNCTION core.bulk_delete_poi_as_garbage(
    p_poi_ids UUID[],
    p_admin_id UUID
) RETURNS VOID AS $$
DECLARE
    v_id UUID;
BEGIN
    FOREACH v_id IN ARRAY p_poi_ids
    LOOP
        PERFORM core.delete_poi_as_garbage(v_id, p_admin_id);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 5. Trigger Function for Automatic Archiving
CREATE OR REPLACE FUNCTION core.on_poi_delete_archive_func()
RETURNS TRIGGER AS $$
DECLARE
    v_coord RECORD;
    v_schema TEXT;
BEGIN
    v_schema := TG_TABLE_SCHEMA;

    -- Check if already in exclusions (to avoid double insert from delete_poi_as_garbage)
    IF EXISTS (SELECT 1 FROM core.poi_exclusions WHERE original_id = OLD.id) THEN
        RETURN OLD;
    END IF;

    -- Get location from related table if in core
    IF v_schema = 'core' THEN
        SELECT * INTO v_coord FROM core.attraction_coordinate WHERE attraction_id = OLD.id LIMIT 1;
        
        INSERT INTO core.poi_exclusions (
            original_id,
            original_schema,
            osm_id,
            osm_type,
            name,
            city,
            state,
            country,
            category,
            latitude,
            longitude,
            reason,
            status,
            data_snapshot
        ) VALUES (
            OLD.id,
            'core',
            OLD.osm_id,
            OLD.osm_type,
            OLD.name,
            OLD.city,
            OLD.state,
            OLD.country,
            OLD.category,
            v_coord.latitude,
            v_coord.longitude,
            'user_deleted',
            'trash',
            to_jsonb(OLD)
        );
    ELSE
        -- Homolog or others: Default to blacklisted (no snapshot)
        INSERT INTO core.poi_exclusions (
            original_id,
            original_schema,
            osm_id,
            osm_type,
            name,
            city,
            state,
            country,
            category,
            latitude,
            longitude,
            reason,
            status
        ) VALUES (
            OLD.id,
            'homolog',
            OLD.osm_id,
            OLD.osm_type,
            OLD.name,
            OLD.city,
            OLD.state,
            OLD.country,
            OLD.category,
            OLD.lat,
            OLD.lon,
            'user_deleted',
            'blacklisted'
        );
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- 6. Deploy Triggers
DROP TRIGGER IF EXISTS tr_poi_delete_archive ON core.attractions;
CREATE TRIGGER tr_poi_delete_archive
    BEFORE DELETE ON core.attractions
    FOR EACH ROW EXECUTE FUNCTION core.on_poi_delete_archive_func();

DROP TRIGGER IF EXISTS tr_poi_delete_archive ON homolog.pois;
CREATE TRIGGER tr_poi_delete_archive
    BEFORE DELETE ON homolog.pois
    FOR EACH ROW EXECUTE FUNCTION core.on_poi_delete_archive_func();

-- 7. Recovery Function
CREATE OR REPLACE FUNCTION core.restore_poi(p_exclusion_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_exclusion RECORD;
    v_restored_id UUID;
BEGIN
    SELECT * INTO v_exclusion FROM core.poi_exclusions WHERE id = p_exclusion_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Exclusion record not found';
    END IF;

    IF v_exclusion.original_schema = 'core' AND v_exclusion.data_snapshot IS NOT NULL THEN
        -- Restore to core.attractions using snapshot
        -- Note: This is a simplified version, might need adjustment for specific columns
        INSERT INTO core.attractions SELECT * FROM jsonb_populate_record(NULL::core.attractions, v_exclusion.data_snapshot)
        RETURNING id INTO v_restored_id;
        
        -- Restore coordinates
        IF v_exclusion.latitude IS NOT NULL AND v_exclusion.longitude IS NOT NULL THEN
            INSERT INTO core.attraction_coordinate (attraction_id, latitude, longitude)
            VALUES (v_restored_id, v_exclusion.latitude, v_exclusion.longitude)
            ON CONFLICT (attraction_id) DO UPDATE SET
                latitude = v_exclusion.latitude,
                longitude = v_exclusion.longitude;
        END IF;
    ELSE
        -- For homolog or items without snapshot, we might just re-insert basic fields
        -- But user said only core needs snapshot.
        RAISE EXCEPTION 'Recovery not supported for this item type (no snapshot)';
    END IF;

    -- Remove from exclusions
    DELETE FROM core.poi_exclusions WHERE id = p_exclusion_id;

    RETURN jsonb_build_object('success', true, 'id', v_restored_id);
END;
$$ LANGUAGE plpgsql;
