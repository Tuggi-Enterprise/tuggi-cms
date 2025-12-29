-- Create cache_narrations table with composite primary key to support multi-language behavioral caching
CREATE TABLE IF NOT EXISTS core.cache_narrations (
  cache_key text not null,
  poi_id uuid not null,
  language text not null,
  travel_mode text not null,
  direction_bucket text not null,
  audio_url text null,
  text_content text null,
  generation_metadata jsonb null,
  hit_count integer null default 0,
  created_at timestamp with time zone null default now(),
  expires_at timestamp with time zone null,
  constraint cache_narrations_pkey primary key (cache_key, language),
  constraint cache_narrations_poi_id_fkey foreign KEY (poi_id) references core.attractions (id) on delete CASCADE,
  constraint check_cache_expiration check ((expires_at > created_at))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_cache_narrations_expires_at on core.cache_narrations (expires_at);
CREATE INDEX IF NOT EXISTS idx_cache_narrations_hash on core.cache_narrations (cache_key);
