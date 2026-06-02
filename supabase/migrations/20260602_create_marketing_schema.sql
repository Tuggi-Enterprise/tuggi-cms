-- ============================================================================
-- Marketing Module — Newsletter (Resend) schema
-- ----------------------------------------------------------------------------
-- Cria o schema dedicado `marketing` (separado de `core` = CMS/POI e
-- `drive` = app users) e as tabelas/RPCs do enviador de newsletter.
--
-- ⚠️  Rodar manualmente no SQL editor do painel Supabase (nunca via CLI).
--     A migração das push notifications (core.* -> marketing.*) está no
--     arquivo 20260602_move_notifications_to_marketing.sql e deve ser rodada
--     DEPOIS desta.
--
-- ⚠️  EXPOR O SCHEMA: adicionar `marketing` em Settings → API → Exposed schemas
--     (mesmo que já é feito para `core`/`drive`). O client chama os RPCs com
--     supabase.schema('marketing').rpc(...) — este projeto NÃO usa o schema
--     `public` (sem wrappers public.*).
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS marketing;
GRANT USAGE ON SCHEMA marketing TO service_role;
GRANT USAGE ON SCHEMA marketing TO authenticated;
GRANT USAGE ON SCHEMA marketing TO postgres;

-- ----------------------------------------------------------------------------
-- Tabela: campanhas de newsletter
-- `content` guarda o conteúdo por idioma, ex:
--   { "pt": { "subject": "...", "title": "...", "paragraphs": ["..."],
--             "cta_label": "...", "cta_url": "...", "hero_image_url": "..." },
--     "en": { ... }, "es": { ... } }
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketing.newsletter_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    default_language TEXT NOT NULL DEFAULT 'pt',
    content JSONB NOT NULL DEFAULT '{}'::jsonb,
    audience_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'draft', -- draft | scheduled | sending | sent | failed
    scheduled_for TIMESTAMP WITH TIME ZONE,
    sent_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES core.cms_users(id),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Tabela: destinatários (estado de entrega + métricas, SSOT por destinatário)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketing.newsletter_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES marketing.newsletter_campaigns(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    user_id UUID,
    language TEXT,
    resend_message_id TEXT,
    status TEXT NOT NULL DEFAULT 'queued', -- queued|sent|delivered|opened|clicked|bounced|complained|failed
    sent_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    opened_at TIMESTAMP WITH TIME ZONE,
    open_count INTEGER NOT NULL DEFAULT 0,
    click_count INTEGER NOT NULL DEFAULT 0,
    error_details TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_newsletter_recipients_campaign ON marketing.newsletter_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_recipients_resend ON marketing.newsletter_recipients(resend_message_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_recipients_email ON marketing.newsletter_recipients(lower(email));

-- ----------------------------------------------------------------------------
-- Tabela: opt-out (SSOT de descadastro, por email)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketing.email_unsubscribes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    unsubscribe_token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    unsubscribed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    source TEXT, -- 'footer_link' | 'list_unsubscribe' | 'complaint' | 'admin'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_unsubscribes_email ON marketing.email_unsubscribes(lower(email));

-- ----------------------------------------------------------------------------
-- Tabela: templates de newsletter (opcional, espelha notification_templates)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketing.newsletter_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    default_language TEXT NOT NULL DEFAULT 'pt',
    content JSONB NOT NULL DEFAULT '{}'::jsonb,
    category TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- RLS + grants (service_role faz tudo; authenticated só via RPCs/wrappers)
-- ----------------------------------------------------------------------------
ALTER TABLE marketing.newsletter_campaigns  ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing.newsletter_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing.email_unsubscribes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing.newsletter_templates  ENABLE ROW LEVEL SECURITY;

GRANT ALL ON marketing.newsletter_campaigns  TO service_role;
GRANT ALL ON marketing.newsletter_recipients TO service_role;
GRANT ALL ON marketing.email_unsubscribes    TO service_role;
GRANT ALL ON marketing.newsletter_templates  TO service_role;

-- ============================================================================
-- RPC: estimar tamanho da audiência (espelha core.estimate_notification_audience)
--   Diferenças vs. push:
--     - JOIN obrigatório em auth.users (garante email não-nulo) no lugar de fcm_tokens
--     - exclui emails presentes em marketing.email_unsubscribes (opt-out)
-- ============================================================================
CREATE OR REPLACE FUNCTION marketing.estimate_newsletter_audience(p_filters JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_query TEXT;
    v_count BIGINT;
BEGIN
    v_query := 'SELECT count(DISTINCT p.id)
                FROM drive.profiles p
                JOIN auth.users au ON au.id = p.id
                WHERE au.email IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM marketing.email_unsubscribes u
                      WHERE lower(u.email) = lower(au.email)
                  )';

    IF p_filters ? 'subscription_tier_id' AND p_filters->>'subscription_tier_id' IS NOT NULL THEN
        v_query := v_query || format(' AND p.subscription_tier_id = %L', (p_filters->>'subscription_tier_id')::uuid);
    END IF;
    IF p_filters ? 'last_platform' AND p_filters->>'last_platform' IS NOT NULL THEN
        v_query := v_query || format(' AND p.last_platform = %L', p_filters->>'last_platform');
    END IF;
    IF p_filters ? 'country' AND p_filters->>'country' IS NOT NULL THEN
        v_query := v_query || format(' AND p.country = %L', p_filters->>'country');
    END IF;
    IF p_filters ? 'language' AND p_filters->>'language' IS NOT NULL THEN
        v_query := v_query || format(' AND p.language = %L', p_filters->>'language');
    END IF;
    IF p_filters ? 'driver_type' AND p_filters->>'driver_type' IS NOT NULL THEN
        v_query := v_query || format(' AND p.driver_type = %L', p_filters->>'driver_type');
    END IF;
    IF p_filters ? 'onboarding_completed' AND p_filters->>'onboarding_completed' IS NOT NULL THEN
        v_query := v_query || format(' AND p.onboarding_completed = %L', (p_filters->>'onboarding_completed')::boolean);
    END IF;
    IF p_filters ? 'created_after' AND p_filters->>'created_after' IS NOT NULL THEN
        v_query := v_query || format(' AND p.created_at >= %L', (p_filters->>'created_after')::timestamptz);
    END IF;
    IF p_filters ? 'created_before' AND p_filters->>'created_before' IS NOT NULL THEN
        v_query := v_query || format(' AND p.created_at <= %L', (p_filters->>'created_before')::timestamptz);
    END IF;
    IF p_filters ? 'last_active_after' AND p_filters->>'last_active_after' IS NOT NULL THEN
        v_query := v_query || format(' AND p.last_sign_in_at >= %L', (p_filters->>'last_active_after')::timestamptz);
    END IF;
    IF p_filters ? 'app_version_lt' AND p_filters->>'app_version_lt' IS NOT NULL THEN
        v_query := v_query || format(' AND p.last_app_version < %L', p_filters->>'app_version_lt');
    END IF;

    EXECUTE v_query INTO v_count;
    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION marketing.estimate_newsletter_audience(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION marketing.estimate_newsletter_audience(JSONB) TO service_role;

-- ============================================================================
-- RPC: resolver a lista de destinatários (usada pela Edge Function send-newsletter)
--   Retorna (email, user_id, language) já filtrando opt-out.
-- ============================================================================
CREATE OR REPLACE FUNCTION marketing.get_newsletter_audience(p_filters JSONB)
RETURNS TABLE(email TEXT, user_id UUID, language TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_query TEXT;
BEGIN
    v_query := 'SELECT DISTINCT au.email::text, p.id, p.language::text
                FROM drive.profiles p
                JOIN auth.users au ON au.id = p.id
                WHERE au.email IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM marketing.email_unsubscribes u
                      WHERE lower(u.email) = lower(au.email)
                  )';

    IF p_filters ? 'subscription_tier_id' AND p_filters->>'subscription_tier_id' IS NOT NULL THEN
        v_query := v_query || format(' AND p.subscription_tier_id = %L', (p_filters->>'subscription_tier_id')::uuid);
    END IF;
    IF p_filters ? 'last_platform' AND p_filters->>'last_platform' IS NOT NULL THEN
        v_query := v_query || format(' AND p.last_platform = %L', p_filters->>'last_platform');
    END IF;
    IF p_filters ? 'country' AND p_filters->>'country' IS NOT NULL THEN
        v_query := v_query || format(' AND p.country = %L', p_filters->>'country');
    END IF;
    IF p_filters ? 'language' AND p_filters->>'language' IS NOT NULL THEN
        v_query := v_query || format(' AND p.language = %L', p_filters->>'language');
    END IF;
    IF p_filters ? 'driver_type' AND p_filters->>'driver_type' IS NOT NULL THEN
        v_query := v_query || format(' AND p.driver_type = %L', p_filters->>'driver_type');
    END IF;
    IF p_filters ? 'onboarding_completed' AND p_filters->>'onboarding_completed' IS NOT NULL THEN
        v_query := v_query || format(' AND p.onboarding_completed = %L', (p_filters->>'onboarding_completed')::boolean);
    END IF;
    IF p_filters ? 'created_after' AND p_filters->>'created_after' IS NOT NULL THEN
        v_query := v_query || format(' AND p.created_at >= %L', (p_filters->>'created_after')::timestamptz);
    END IF;
    IF p_filters ? 'created_before' AND p_filters->>'created_before' IS NOT NULL THEN
        v_query := v_query || format(' AND p.created_at <= %L', (p_filters->>'created_before')::timestamptz);
    END IF;
    IF p_filters ? 'last_active_after' AND p_filters->>'last_active_after' IS NOT NULL THEN
        v_query := v_query || format(' AND p.last_sign_in_at >= %L', (p_filters->>'last_active_after')::timestamptz);
    END IF;
    IF p_filters ? 'app_version_lt' AND p_filters->>'app_version_lt' IS NOT NULL THEN
        v_query := v_query || format(' AND p.last_app_version < %L', p_filters->>'app_version_lt');
    END IF;

    RETURN QUERY EXECUTE v_query;
END;
$$;

-- Apenas o service_role (Edge Function) precisa resolver a lista completa de emails.
GRANT EXECUTE ON FUNCTION marketing.get_newsletter_audience(JSONB) TO service_role;

-- ============================================================================
-- RPCs de templates (espelham os RPCs de notification_templates)
-- ============================================================================
CREATE OR REPLACE FUNCTION marketing.get_newsletter_templates()
RETURNS SETOF marketing.newsletter_templates
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY SELECT * FROM marketing.newsletter_templates ORDER BY created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION marketing.create_newsletter_template(p_template JSONB)
RETURNS marketing.newsletter_templates
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result marketing.newsletter_templates;
BEGIN
    INSERT INTO marketing.newsletter_templates (name, default_language, content, category, is_active)
    VALUES (
        p_template->>'name',
        COALESCE(p_template->>'default_language', 'pt'),
        COALESCE(p_template->'content', '{}'::jsonb),
        p_template->>'category',
        COALESCE((p_template->>'is_active')::boolean, true)
    )
    RETURNING * INTO v_result;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION marketing.update_newsletter_template(p_id UUID, p_updates JSONB)
RETURNS marketing.newsletter_templates
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result marketing.newsletter_templates;
BEGIN
    UPDATE marketing.newsletter_templates
    SET
        name = COALESCE(p_updates->>'name', name),
        default_language = COALESCE(p_updates->>'default_language', default_language),
        content = COALESCE(p_updates->'content', content),
        category = COALESCE(p_updates->>'category', category),
        is_active = COALESCE((p_updates->>'is_active')::boolean, is_active),
        updated_at = NOW()
    WHERE id = p_id
    RETURNING * INTO v_result;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION marketing.delete_newsletter_template(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM marketing.newsletter_templates WHERE id = p_id;
END;
$$;

-- Sem wrappers public.* — o client chama via supabase.schema('marketing').rpc(...)
GRANT EXECUTE ON FUNCTION marketing.get_newsletter_templates() TO authenticated;
GRANT EXECUTE ON FUNCTION marketing.create_newsletter_template(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION marketing.update_newsletter_template(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION marketing.delete_newsletter_template(UUID) TO authenticated;

-- ============================================================================
-- CRON: processar campanhas agendadas
--   Mesmo padrão de core.trigger_process_scheduled_notifications (Vault):
--   busca SUPABASE_URL / SERVICE_ROLE_KEY em vault.decrypted_secrets.
-- ============================================================================
CREATE OR REPLACE FUNCTION marketing.trigger_process_scheduled_newsletters()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text;
  v_key text;
  response_status integer;
  response_content text;
BEGIN
  SELECT TRIM(decrypted_secret) INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;

  SELECT TRIM(decrypted_secret) INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY' LIMIT 1;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'Skipping newsletter trigger: SUPABASE_URL ou SERVICE_ROLE_KEY ausentes no Vault.';
    RETURN;
  END IF;

  v_url := rtrim(v_url, '/') || '/functions/v1/send-newsletter/process-scheduled';

  SELECT status, content INTO response_status, response_content
  FROM http((
    'POST',
    v_url,
    ARRAY[
      http_header('apikey', v_key),
      http_header('Authorization', 'Bearer ' || v_key),
      http_header('Content-Type', 'application/json')
    ],
    'application/json',
    '{}'
  ));

  IF response_status >= 400 THEN
    RAISE WARNING 'Scheduled Newsletter Job Failed. Status: %, Content: %', response_status, response_content;
  END IF;
END;
$$;

SELECT cron.schedule(
  'process-newsletters',
  '* * * * *',
  'SELECT marketing.trigger_process_scheduled_newsletters();'
);

GRANT USAGE ON SCHEMA marketing TO postgres;
GRANT EXECUTE ON FUNCTION marketing.trigger_process_scheduled_newsletters() TO postgres;
