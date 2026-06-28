-- ============================================================================
-- Broadcast → espelhar no inbox (drive.user_notifications)
-- ----------------------------------------------------------------------------
-- O envio type='user' já espelha cada push no inbox (SSOT do Notification Center
-- do app + badge de não-lidas). O broadcast NÃO espelhava: chegava só como FCM,
-- não aparecia no app, e o notification_logs ia com user_ids vazio.
--
-- Esta RPC insere UMA linha de inbox por usuário da audiência (mesmo conjunto e
-- mesmo filtro de core.get_audience_push_tokens — SSOT core.build_audience_filter)
-- num único INSERT … SELECT (set-based, escala), e devolve os user_ids inseridos
-- para a Edge Function preencher notification_logs.user_ids.
--
-- ⚠️  Rodar manualmente no SQL editor do painel.
-- ============================================================================
CREATE OR REPLACE FUNCTION core.broadcast_persist_inbox(
    p_filters  JSONB,
    p_type     TEXT,
    p_title    TEXT,
    p_body     TEXT,
    p_data     JSONB DEFAULT '{}'::jsonb,
    p_deeplink TEXT  DEFAULT NULL
)
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_where TEXT := core.build_audience_filter(p_filters);
    v_ids   UUID[];
BEGIN
    EXECUTE
      'WITH aud AS (
           SELECT p.id
             FROM drive.profiles p
            WHERE ( EXISTS (SELECT 1 FROM drive.fcm_tokens t
                             WHERE t.user_id = p.id AND t.is_active = true)
                    OR p.push_token IS NOT NULL )' || v_where || '
       ), ins AS (
           INSERT INTO drive.user_notifications (user_id, type, title, body, data, deeplink)
           SELECT id, $1, $2, $3, $4, $5 FROM aud
           RETURNING user_id
       )
       SELECT array_agg(user_id) FROM ins'
    INTO v_ids
    USING p_type, p_title, p_body, p_data, p_deeplink;

    RETURN COALESCE(v_ids, ARRAY[]::UUID[]);
END;
$$;

GRANT EXECUTE ON FUNCTION core.broadcast_persist_inbox(JSONB, TEXT, TEXT, TEXT, JSONB, TEXT) TO service_role;
