-- Migration: functional GiST index for the trip "missed POIs" corridor query
-- Date: 2026-06-12
-- Purpose: accelerate drive.get_trip_exploration_stats' missed-POIs block, which runs
--          ST_DWithin(trail::geography, ST_SetSRID(ST_MakePoint(longitude, latitude),4326)::geography, radius)
--          against core.attraction_coordinate (~640k rows, growing). The point is computed
--          inline from float columns, so only a functional index on the EXACT same
--          expression is usable by the planner.
--
-- GOTCHA: the indexed expression must match the query byte-for-byte after parse —
--         same arg order ST_MakePoint(longitude, latitude), SRID 4326, plain ::geography cast.
--         Any divergence (typmod cast, geography(...) call form, swapped args) => seq scan.
--
-- NOTE: the Supabase dashboard SQL editor (and most migration runners) wrap statements in a
--       transaction, where CREATE INDEX CONCURRENTLY is not allowed (25001). This file uses a
--       plain CREATE INDEX, which DOES run in a transaction. Trade-off: it takes a SHARE lock
--       that blocks WRITES (not reads) to core.attraction_coordinate during the build
--       (~640k rows -> seconds to ~1 min). For a zero-write-downtime build instead, run the
--       CONCURRENTLY variant (commented below) directly via psql OUTSIDE any transaction.

CREATE INDEX IF NOT EXISTS idx_attraction_coordinate_point_geog
ON core.attraction_coordinate
USING GIST ((ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography));

ANALYZE core.attraction_coordinate;

-- Zero-write-lock alternative (run via psql, NOT in a transaction):
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attraction_coordinate_point_geog
-- ON core.attraction_coordinate
-- USING GIST ((ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography));
