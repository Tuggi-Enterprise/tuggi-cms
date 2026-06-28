-- ============================================================================
-- Audience filter — SSOT (push + newsletter)
-- ----------------------------------------------------------------------------
-- Unifica a segmentação de audiência num único builder de WHERE
-- (core.build_audience_filter) consumido por TODAS as RPCs de push e newsletter.
--
-- Corrige 2 bugs reportados:
--   1) language exato (`= 'pt-br'`) ignorava os usuários gravados como `pt`
--      (o app grava o languageCode de 2 letras no heartbeat, mas o signup
--      semeia 'pt-BR'). Agora: ILIKE prefixo case-insensitive — 'pt' casa
--      pt / pt-br / pt-BR / pt-PT.
--   2) broadcast não filtrava por plataforma (last_platform só existe em
--      drive.profiles; fcm_tokens não tem coluna de plataforma). Nova RPC
--      core.get_audience_push_tokens resolve os tokens já filtrados via JOIN.
--
-- ⚠️  Rodar manualmente no SQL editor do painel (DDL nunca via CLI).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SSOT: builder do fragmento WHERE (aliasa drive.profiles como `p`)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.build_audience_filter(p_filters JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v TEXT := '';
BEGIN
    IF p_filters IS NULL THEN
        RETURN '';
    END IF;

    -- Subscription Tier
    IF p_filters ? 'subscription_tier_id' AND p_filters->>'subscription_tier_id' IS NOT NULL THEN
        v := v || format(' AND p.subscription_tier_id = %L', (p_filters->>'subscription_tier_id')::uuid);
    END IF;

    -- Platform (last_platform: 'android' / 'ios' — match exato)
    IF p_filters ? 'last_platform' AND p_filters->>'last_platform' IS NOT NULL THEN
        v := v || format(' AND p.last_platform = %L', p_filters->>'last_platform');
    END IF;

    -- Country
    IF p_filters ? 'country' AND p_filters->>'country' IS NOT NULL THEN
        v := v || format(' AND p.country = %L', p_filters->>'country');
    END IF;

    -- Language (PREFIXO case-insensitive: 'pt' casa pt / pt-br / pt-BR / pt-PT)
    IF p_filters ? 'language' AND p_filters->>'language' IS NOT NULL THEN
        v := v || format(' AND p.language ILIKE %L', (p_filters->>'language') || '%');
    END IF;

    -- Driver Type
    IF p_filters ? 'driver_type' AND p_filters->>'driver_type' IS NOT NULL THEN
        v := v || format(' AND p.driver_type = %L', p_filters->>'driver_type');
    END IF;

    -- Onboarding Completed
    IF p_filters ? 'onboarding_completed' AND p_filters->>'onboarding_completed' IS NOT NULL THEN
        v := v || format(' AND p.onboarding_completed = %L', (p_filters->>'onboarding_completed')::boolean);
    END IF;

    -- Created At (range)
    IF p_filters ? 'created_after' AND p_filters->>'created_after' IS NOT NULL THEN
        v := v || format(' AND p.created_at >= %L', (p_filters->>'created_after')::timestamptz);
    END IF;
    IF p_filters ? 'created_before' AND p_filters->>'created_before' IS NOT NULL THEN
        v := v || format(' AND p.created_at <= %L', (p_filters->>'created_before')::timestamptz);
    END IF;

    -- Last Active
    IF p_filters ? 'last_active_after' AND p_filters->>'last_active_after' IS NOT NULL THEN
        v := v || format(' AND p.last_sign_in_at >= %L', (p_filters->>'last_active_after')::timestamptz);
    END IF;

    -- App Version
    IF p_filters ? 'app_version_lt' AND p_filters->>'app_version_lt' IS NOT NULL THEN
        v := v || format(' AND p.last_app_version < %L', p_filters->>'app_version_lt');
    END IF;

    RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION core.build_audience_filter(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION core.build_audience_filter(JSONB) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. PUSH — estimativa de audiência (usa o builder)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.estimate_notification_audience(p_filters JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count BIGINT;
BEGIN
    EXECUTE
        'SELECT count(DISTINCT p.id)
           FROM drive.profiles p
           JOIN drive.fcm_tokens t ON p.id = t.user_id
          WHERE t.is_active = true' || core.build_audience_filter(p_filters)
    INTO v_count;
    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION core.estimate_notification_audience(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION core.estimate_notification_audience(JSONB) TO service_role;

-- Wrapper público (mantém a chamada do client: supabase.rpc('estimate_notification_audience'))
CREATE OR REPLACE FUNCTION public.estimate_notification_audience(p_filters JSONB)
RETURNS BIGINT AS $$
  SELECT core.estimate_notification_audience(p_filters);
$$ LANGUAGE sql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.estimate_notification_audience(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.estimate_notification_audience(JSONB) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. PUSH — resolver tokens da audiência (NOVA; usada pela Edge Function)
--    Une fcm_tokens ativos (JOIN profiles) + profiles.push_token legado,
--    ambos filtrados pelo MESMO builder. Só service_role (tokens sensíveis).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.get_audience_push_tokens(p_filters JSONB)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_where  TEXT := core.build_audience_filter(p_filters);
    v_tokens TEXT[];
BEGIN
    EXECUTE format($q$
        SELECT array_agg(DISTINCT tok)
          FROM (
                SELECT t.fcm_token AS tok
                  FROM drive.profiles p
                  JOIN drive.fcm_tokens t ON t.user_id = p.id
                 WHERE t.is_active = true %1$s
                UNION
                SELECT p.push_token AS tok
                  FROM drive.profiles p
                 WHERE p.push_token IS NOT NULL %1$s
               ) s
         WHERE tok IS NOT NULL AND tok <> ''
    $q$, v_where)
    INTO v_tokens;

    RETURN COALESCE(v_tokens, ARRAY[]::TEXT[]);
END;
$$;

GRANT EXECUTE ON FUNCTION core.get_audience_push_tokens(JSONB) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. NEWSLETTER — estimativa (usa o builder; mesma lógica de language)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marketing.estimate_newsletter_audience(p_filters JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count BIGINT;
BEGIN
    EXECUTE
        'SELECT count(DISTINCT p.id)
           FROM drive.profiles p
           JOIN auth.users au ON au.id = p.id
          WHERE au.email IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM marketing.email_unsubscribes u
                 WHERE lower(u.email) = lower(au.email)
            )' || core.build_audience_filter(p_filters)
    INTO v_count;
    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION marketing.estimate_newsletter_audience(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION marketing.estimate_newsletter_audience(JSONB) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. NEWSLETTER — resolver destinatários (usa o builder; mantém assinatura)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS marketing.get_newsletter_audience(JSONB);

CREATE FUNCTION marketing.get_newsletter_audience(p_filters JSONB)
RETURNS TABLE(email TEXT, user_id UUID, language TEXT, name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT au.email::text, p.id, p.language::text,
                COALESCE(au.raw_user_meta_data->>''full_name'',
                         au.raw_user_meta_data->>''name'', '''')::text AS name
           FROM drive.profiles p
           JOIN auth.users au ON au.id = p.id
          WHERE au.email IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM marketing.email_unsubscribes u
                 WHERE lower(u.email) = lower(au.email)
            )' || core.build_audience_filter(p_filters);
END;
$$;

GRANT EXECUTE ON FUNCTION marketing.get_newsletter_audience(JSONB) TO service_role;

-- ----------------------------------------------------------------------------
-- 6. Scheduled broadcasts — coluna de filtros de audiência
-- ----------------------------------------------------------------------------
ALTER TABLE marketing.scheduled_notifications
    ADD COLUMN IF NOT EXISTS audience_filters JSONB NOT NULL DEFAULT '{}'::jsonb;
