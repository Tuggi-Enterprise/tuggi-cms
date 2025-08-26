-- A tabela core.countries já existe, apenas criando a tabela de fontes de verificação

-- Criar tabela de fontes de verificação por país
create table core.country_verification_sources (
   id uuid not null default gen_random_uuid (),
   country_id uuid not null,
   source_name text not null,
   source_type text not null,
   base_url text not null,
   search_endpoint text null,
   api_key_required boolean null default false,
   priority integer null default 1,
   is_active boolean null default true,
   config jsonb null default '{}'::jsonb,
   created_at timestamp with time zone null default now(),
   updated_at timestamp with time zone null default now(),
   constraint country_verification_sources_pkey primary key (id),
   constraint unique_country_source unique (country_id, source_name),
   constraint country_verification_sources_country_id_fkey foreign KEY (country_id) references core.countries (id) on delete CASCADE,
   constraint country_verification_sources_priority_check check (
     (
       (priority >= 1)
       and (priority <= 10)
     )
   )
) TABLESPACE pg_default;

-- Índices para a tabela country_verification_sources
create index IF not exists idx_verification_sources_country on core.country_verification_sources using btree (country_id) TABLESPACE pg_default;

create index IF not exists idx_verification_sources_active on core.country_verification_sources using btree (is_active) TABLESPACE pg_default
where
  (is_active = true);

create index IF not exists idx_verification_sources_priority on core.country_verification_sources using btree (country_id, priority) TABLESPACE pg_default;

create index IF not exists idx_verification_sources_type on core.country_verification_sources using btree (source_type) TABLESPACE pg_default;

-- Trigger para atualizar updated_at
create trigger update_verification_sources_updated_at BEFORE
update on core.country_verification_sources for EACH row
execute FUNCTION core.update_updated_at_column ();

-- Inserir dados do México
INSERT INTO core.countries (code, name, name_native, flag_emoji, language_code, is_active)
VALUES ('MX', 'México', 'México', '🇲🇽', 'es', true);