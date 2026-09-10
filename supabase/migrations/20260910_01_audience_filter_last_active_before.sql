-- ============================================================================
-- core.build_audience_filter — a chave que faltava: `last_active_before`
-- ----------------------------------------------------------------------------
-- Sem ela não existe winback ("instalou, viajou e sumiu") nem sunset de
-- inativo, que são o caso de uso nº 1 de uma base de turistas: o par
-- `last_active_after` sozinho só sabe dizer "quem ESTÁ ativo".
--
-- ⚠️  ARMADILHA CONFIRMADA (CLAUDE.md §"o banco está à frente"): o corpo abaixo
--     foi lido do BANCO por `pg_get_functiondef` em 2026-09-10 — NÃO do arquivo
--     `20260628_audience_filter_ssot.sql`, que está DESATUALIZADO. O que existe
--     só no banco e o arquivo antigo não tem:
--       • a recusa TGU43 de `country` / `driver_type` (BR-USUARIO-043 item 5b);
--       • a ausência dos ramos `country` e `driver_type`;
--       • os comentários de BR-AUDIO-017 no ramo `language`.
--     Recriar a partir do arquivo teria APAGADO a recusa TGU43 e reaberto a
--     segmentação por dado de pesquisa demográfica.
--
-- Comportamento das outras chaves: intacto. Assinatura: intacta.
--
-- ⚠️  Rodar manualmente no SQL editor do painel (DDL nunca via CLI).
-- ============================================================================

-- ─────────────────────────────── UP ────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.build_audience_filter(p_filters jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
    v TEXT := '';
BEGIN
    IF p_filters IS NULL THEN
        RETURN '';
    END IF;

    -- BR-USUARIO-043 item 5b / BR-USUARIO-044 item 9 — a coleta demográfica tem
    -- UMA finalidade, decidir o que produzir, e segmentar campanha NÃO é ela.
    -- Recusa alta e não descarte silencioso: audiência que ignora um filtro em
    -- silêncio manda campanha para MAIS gente do que quem apertou o botão quis.
    -- Quem precisa falar com o motorista PARCEIRO usa o vínculo de cliente
    -- (drive.profiles.client_id), que é fato operacional de parceria — nunca a
    -- resposta de pesquisa do turista, que a coluna não distingue.
    IF p_filters ? 'country' OR p_filters ? 'driver_type' THEN
        RAISE EXCEPTION
          'TGU43: filtro de audiência por dado da coleta demográfica não é '
          'permitido (BR-USUARIO-043 item 5b). Chaves recusadas: country, '
          'driver_type.'
          USING ERRCODE = 'TGU43',
                HINT = 'para falar com o parceiro, segmente pelo vínculo de cliente, não pela resposta de pesquisa';
    END IF;

    -- Subscription Tier
    IF p_filters ? 'subscription_tier_id' AND p_filters->>'subscription_tier_id' IS NOT NULL THEN
        v := v || format(' AND p.subscription_tier_id = %L', (p_filters->>'subscription_tier_id')::uuid);
    END IF;

    -- Platform (last_platform: 'android' / 'ios' — match exato)
    IF p_filters ? 'last_platform' AND p_filters->>'last_platform' IS NOT NULL THEN
        v := v || format(' AND p.last_platform = %L', p_filters->>'last_platform');
    END IF;

    -- Language (PREFIXO case-insensitive: 'pt' casa pt / pt-br / pt-BR / pt-PT)
    -- `drive.profiles.language` é o LOCALE DE INTERFACE (BR-AUDIO-017), que o
    -- app escreve sozinho — não é resposta de pesquisa e não é
    -- `spoken_languages`, que NUNCA entra neste filtro.
    IF p_filters ? 'language' AND p_filters->>'language' IS NOT NULL THEN
        v := v || format(' AND p.language ILIKE %L', (p_filters->>'language') || '%');
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

    -- Last Active (range) — `last_active_before` é a chave de WINBACK e de
    -- SUNSET de inativo. `last_sign_in_at IS NULL` NÃO entra: perfil que nunca
    -- assinou sessão não é "sumiu", é "nunca chegou", e juntar os dois num
    -- filtro só faria a audiência mentir sobre quem ela alcança.
    IF p_filters ? 'last_active_after' AND p_filters->>'last_active_after' IS NOT NULL THEN
        v := v || format(' AND p.last_sign_in_at >= %L', (p_filters->>'last_active_after')::timestamptz);
    END IF;
    IF p_filters ? 'last_active_before' AND p_filters->>'last_active_before' IS NOT NULL THEN
        v := v || format(' AND p.last_sign_in_at <= %L', (p_filters->>'last_active_before')::timestamptz);
    END IF;

    -- App Version
    IF p_filters ? 'app_version_lt' AND p_filters->>'app_version_lt' IS NOT NULL THEN
        v := v || format(' AND p.last_app_version < %L', p_filters->>'app_version_lt');
    END IF;

    RETURN v;
END;
$function$;

GRANT EXECUTE ON FUNCTION core.build_audience_filter(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION core.build_audience_filter(jsonb) TO service_role;

-- ─────────────────────────────── DOWN ──────────────────────────────────────
-- Reversível sem perda: é a MESMA função sem o bloco `last_active_before`.
-- Rodar o bloco abaixo restaura o estado de 2026-09-10 antes desta migration.
--
-- BEGIN;
--   -- (cole aqui o corpo do UP acima e apague o IF de `last_active_before`)
--   -- Alternativa mecânica, se o corpo já mudou de novo desde então:
--   --   SELECT pg_get_functiondef('core.build_audience_filter(jsonb)'::regprocedure);
--   -- guarde a saída ANTES de rodar o UP; ela É o down desta migration.
-- COMMIT;
