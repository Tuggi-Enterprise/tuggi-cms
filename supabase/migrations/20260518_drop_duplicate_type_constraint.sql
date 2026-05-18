-- Drop duplicate CHECK constraint on attraction_trigger_points.type
--
-- Two constraints existed simultaneously:
--   chk_valid_type (old): only 'primary','secondary','fallback','special','testing'
--   attraction_trigger_points_type_check (new): adds 'geofence','entry','exit','approach','custom'
--
-- The old constraint caused full RPC rollback when inserting geofence TPs,
-- silently keeping stale TPs in the DB instead of updating them.
-- The new constraint (attraction_trigger_points_type_check) is the SSOT.

ALTER TABLE core.attraction_trigger_points
DROP CONSTRAINT IF EXISTS chk_valid_type;
