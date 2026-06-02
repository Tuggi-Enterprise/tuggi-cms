-- ============================================================================
-- Marketing — Personalização da newsletter ({{first_name}} / {{name}})
-- ----------------------------------------------------------------------------
-- get_newsletter_audience passa a retornar também o NOME do usuário (de
-- auth.users.raw_user_meta_data), para a Edge Function substituir os tokens.
--
-- ⚠️  Rodar manualmente no SQL editor (DDL nunca via CLI). DROP necessário
--     porque mudamos a assinatura (coluna nova no RETURNS TABLE).
-- ============================================================================

DROP FUNCTION IF EXISTS marketing.get_newsletter_audience(JSONB);

CREATE FUNCTION marketing.get_newsletter_audience(p_filters JSONB)
RETURNS TABLE(email TEXT, user_id UUID, language TEXT, name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_query TEXT;
BEGIN
    v_query := 'SELECT DISTINCT au.email::text, p.id, p.language::text,
                       COALESCE(au.raw_user_meta_data->>''full_name'',
                                au.raw_user_meta_data->>''name'', '''')::text AS name
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

GRANT EXECUTE ON FUNCTION marketing.get_newsletter_audience(JSONB) TO service_role;
