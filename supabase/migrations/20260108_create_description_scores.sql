-- Create description_scores table for quality auditing and history
create table IF NOT EXISTS core.description_scores (
  id uuid not null default gen_random_uuid (),
  description_id uuid not null,
  attraction_id uuid not null,
  lang text not null default 'pt-BR'::text,
  description_hash text not null,
  score_overall integer not null,
  subscores jsonb not null,
  flags text[] not null,
  verifier_version text not null,
  llm_model text null,
  confidence numeric null,
  created_at timestamp with time zone null default now(),
  constraint description_scores_pkey primary key (id),
  constraint description_scores_attraction_id_fkey foreign KEY (attraction_id) references core.attractions (id) on delete CASCADE,
  constraint description_scores_description_id_fkey foreign KEY (description_id) references core.attraction_descriptions (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_desc_scores_desc on core.description_scores using btree (description_id, created_at desc) TABLESPACE pg_default;

create index IF not exists idx_desc_scores_hash on core.description_scores using btree (description_hash) TABLESPACE pg_default;

-- Create the mirror function
CREATE OR REPLACE FUNCTION core.fn_update_description_score_mirror()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Mirrors the latest score to the attraction_descriptions table
  -- Adjustment: using last_score_overall instead of legacy verification_score
  UPDATE core.attraction_descriptions
  SET last_score_overall = NEW.score_overall,
      last_score_version = NEW.verifier_version,
      last_verified_at = NOW(),
      updated_at = NOW()
  WHERE id = NEW.description_id;
  
  RETURN NEW;
END;
$function$;

-- Drop trigger if exists to avoid errors on duplicate creation
DROP TRIGGER IF EXISTS trg_scores_mirror ON core.description_scores;
create trigger trg_scores_mirror
after INSERT on core.description_scores for EACH row
execute FUNCTION core.fn_update_description_score_mirror ();

-- Enable RLS
ALTER TABLE core.description_scores ENABLE ROW LEVEL SECURITY;

-- Policies
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated users to read scores' AND tablename = 'description_scores') THEN
        CREATE POLICY "Allow authenticated users to read scores" 
        ON core.description_scores FOR SELECT 
        TO authenticated 
        USING (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow service_role full access' AND tablename = 'description_scores') THEN
        CREATE POLICY "Allow service_role full access" 
        ON core.description_scores FOR ALL 
        TO service_role 
        USING (true) 
        WITH CHECK (true);
    END IF;
END $$;
