-- Create import_batches table for tracking POI import operations
CREATE TABLE IF NOT EXISTS core.import_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NULL REFERENCES auth.users(id),
  polygon_id uuid NULL,
  search_category text NULL,
  total_found integer NULL DEFAULT 0,
  total_imported integer NULL DEFAULT 0,
  created_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  
  CONSTRAINT import_batches_pkey PRIMARY KEY (id),
  CONSTRAINT import_batches_id_key UNIQUE (id)
) TABLESPACE pg_default;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_import_batches_user_id ON core.import_batches USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_created_at ON core.import_batches USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_batches_category ON core.import_batches USING btree (search_category);
CREATE INDEX IF NOT EXISTS idx_import_batches_polygon ON core.import_batches USING btree (polygon_id);

-- Add comment
COMMENT ON TABLE core.import_batches IS 'Tracks POI import operations for analytics and debugging'; 