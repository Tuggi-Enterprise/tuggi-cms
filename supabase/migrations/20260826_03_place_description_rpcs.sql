-- ============================================================================
-- PLACE DESCRIPTION POLICY — as RPCs, and the plan on the Places card
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
--
-- Pré-requisito: 20260826_02_partner_description_exception (as três colunas).
--
-- POR QUE RPC E NÃO `.from()` NO CÓDIGO. Decisão do operador em 2026-08-26. O que ela compra aqui
-- é concreto e não estilo: o schema `partner` é INVISÍVEL para `authenticated` — falta `USAGE`, e
-- o PostgREST devolve 42501 num `error` que um `?? null` transforma em "não paga". Uma função
-- SECURITY DEFINER atravessa essa fronteira uma vez, num lugar auditável, em vez de espalhar
-- leituras que só funcionam com service role. E a guarda de não sobrescrever descrição alheia
-- deixa de ser um `if` no Node entre um SELECT e um UPDATE — dois operadores em duas abas — e
-- passa a ser uma sentença só.
--
-- O QUE DELIBERADAMENTE **NÃO** ENTRA EM SQL: a régua de quem paga. `derivePartnerPlan` /
-- `paymentStance` (`lib/clients/partner-plan.ts`) é o único lugar que decide isso, e ele sabe
-- coisas que uma função não deve reaprender — que `monthly_fee_cents` ausente NÃO é zero
-- (BR-B2B-017, item 6), que cortesia sem motivo escrito é cadastro incompleto, e que contrato
-- manda no cadastro que manda na proposta. Estas funções devolvem os FATOS; quem decide continua
-- sendo um módulo puro, com teste. Reimplementar a régua aqui é a segunda casa do mesmo fato que
-- a §6 do CLAUDE.md chama de defeito mais caro.
--
-- ROLLBACK: `DROP FUNCTION` de cada uma das três novas, e reaplicar `core.cms_list_places` sem as
-- sete colunas de plano (a definição anterior está no `pg_get_functiondef` de 2026-08-26, colada
-- no card). Nenhum dado é escrito por esta migration.
-- ============================================================================

-- 1) OS FATOS DE UM LOCAL --------------------------------------------------------------------
-- Uma leitura, três schemas. Substitui quatro `.from()` no serviço do CMS.
DROP FUNCTION IF EXISTS core.cms_place_description_facts(uuid, text, text);
CREATE FUNCTION core.cms_place_description_facts(
  p_attraction_id uuid,
  -- O idioma e o gênero da linha-base viajam como PARÂMETRO porque quem os declara é o CMS
  -- (`BASE_LANGUAGE` / `BASE_GENDER`). Cravá-los aqui seria a segunda casa de dois valores que
  -- `generate-description` também usa.
  p_language text,
  p_gender text
) RETURNS TABLE(
  attraction_id uuid,
  name text,
  city text,
  entity_kind text,
  partner_client_id uuid,
  exception_at timestamptz,
  exception_by uuid,
  exception_reason text,
  monthly_fee_cents integer,
  is_courtesy boolean,
  courtesy_reason text,
  plan_choice text,
  contract_tier text,
  proposal_answers jsonb,
  base_description text,
  base_has_audio boolean,
  base_generation_kind text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions'
AS $$
BEGIN
  -- Ferramenta de CMS, como toda `cms_*` deste schema. Não-CMS => vazio, nunca erro.
  IF NOT core.is_active_cms_user() THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.name,
    a.city,
    a.entity_kind,
    a.partner_client_id,
    a.partner_description_exception_at,
    a.partner_description_exception_by,
    a.partner_description_exception_reason,
    cl.monthly_fee_cents,
    cl.is_courtesy,
    cl.courtesy_reason,
    sub.answers ->> 'plan_choice',
    ct.tier,
    -- `answers` INTEIRO, e ele não sai deste servidor: a rota devolve ao navegador só o insumo
    -- já derivado (`PartnerStoryInput`). Vai inteiro porque a lista das quatro perguntas de
    -- história é do CMS (`PARTNER_STORY_FIELDS`) — recortá-la aqui criaria uma segunda
    -- declaração dela, que é como uma pergunta nova entraria no formulário e sumiria do áudio.
    sub.answers,
    ad.description,
    (ad.audio_url IS NOT NULL),
    ad.generation_meta ->> 'kind'
  FROM core.attractions a
  LEFT JOIN partner.clients cl
    ON cl.id = a.partner_client_id
  -- O contrato VIVO é o mais novo sem `superseded_by` — mesma definição de
  -- `loadLiveContracts`, e é dela que sai `tier`.
  LEFT JOIN LATERAL (
    SELECT c.tier
    FROM partner.partner_contracts c
    WHERE c.client_id = a.partner_client_id
      AND c.superseded_by IS NULL
    ORDER BY c.created_at DESC
    LIMIT 1
  ) ct ON true
  -- A proposta de que o cliente foi promovido. `limit(1)`: `promoted_client_id` não tem índice
  -- único, e um cliente com duas propostas promovidas é uma duplicata que alguém resolveu
  -- promovendo as duas — a mais recente é a corrente.
  LEFT JOIN LATERAL (
    SELECT s.answers
    FROM partner.partner_form_submissions s
    WHERE s.promoted_client_id = a.partner_client_id
      AND s.status = 'promoted'
    ORDER BY s.promoted_at DESC
    LIMIT 1
  ) sub ON true
  LEFT JOIN core.attraction_descriptions ad
    ON ad.attraction_id = a.id
   AND ad.language = p_language
   AND ad.gender = p_gender
  WHERE a.id = p_attraction_id;
END;
$$;

-- 2) O NOME NO LUGAR DA DESCRIÇÃO ------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.cms_apply_name_only_description(
  p_attraction_id uuid,
  p_language text,
  p_gender text
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions'
AS $$
DECLARE
  v_name    text;
  v_current core.attraction_descriptions%ROWTYPE;
  v_found   boolean;
BEGIN
  IF NOT core.is_active_cms_editor_or_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT btrim(a.name) INTO v_name FROM core.attractions a WHERE a.id = p_attraction_id;
  IF v_name IS NULL OR v_name = '' THEN
    RETURN 'skipped';
  END IF;

  -- ESTA É A GUARDA, E É POR ELA QUE A ESCRITA MORA AQUI. O 5º caso de borda de BR-B2B-016 diz
  -- que "'Somente o nome' não é degradação do que já existe" — POI de parceiro já publicado com
  -- descrição NÃO a perde por causa desta regra. `PlaceLinkPanel` vincula POIs que o catálogo
  -- narrava anos antes da parceria, e uma escrita cega aqui trocaria uma narração curada por um
  -- substantivo próprio, em silêncio.
  --
  -- Ela fica em SQL e não no Node porque no Node ela seria um `if` entre um SELECT e um UPDATE:
  -- dois operadores em duas abas, e a descrição que chegou no meio é apagada. Aqui é uma
  -- sentença, e a linha está travada enquanto ela decide.
  SELECT * INTO v_current
  FROM core.attraction_descriptions ad
  WHERE ad.attraction_id = p_attraction_id
    AND ad.language = p_language
    AND ad.gender = p_gender
  FOR UPDATE;
  v_found := FOUND;

  IF v_found
     AND coalesce(v_current.description, '') <> ''
     AND v_current.description <> '[PROCESSING]'
     AND v_current.generation_meta ->> 'kind' IS DISTINCT FROM 'partner_name_only' THEN
    RETURN 'blocked';
  END IF;

  IF v_found AND v_current.description = v_name THEN
    -- Idempotente: nada é escrito, e o `audio_url` que já existe sobrevive em vez de ser
    -- derrubado e re-sintetizado a cada gravação do formulário.
    RETURN 'unchanged';
  END IF;

  INSERT INTO core.attraction_descriptions AS ad (
    attraction_id, language, gender, description, facts_pack_json,
    audio_url, updated_at, verification_status, generation_meta
  ) VALUES (
    p_attraction_id, p_language, p_gender, v_name, '[]'::jsonb,
    NULL, now(),
    -- Não passa por verificação: não há fato a verificar num nome próprio, e deixá-la em
    -- `needs_review` mandaria o operador conferir a única coisa que a regra já decidiu.
    'approved', jsonb_build_object('kind', 'partner_name_only')
  )
  ON CONFLICT (attraction_id, language, gender) DO UPDATE
    SET description         = EXCLUDED.description,
        -- Texto novo NUNCA fica pareado com áudio antigo — o mesmo invariante que
        -- `generate-description` defende no upsert dele.
        audio_url           = NULL,
        facts_pack_json     = EXCLUDED.facts_pack_json,
        updated_at          = EXCLUDED.updated_at,
        verification_status = EXCLUDED.verification_status,
        generation_meta     = EXCLUDED.generation_meta;

  RETURN 'written';
END;
$$;

-- 3) A EXCEÇÃO DO OPERADOR -------------------------------------------------------------------
-- QUEM FUROU SAI DE `auth.uid()`, NUNCA DE PARÂMETRO. Uma RPC que aceita "por quem" como
-- argumento assina em nome de terceiro para qualquer chamador — foi o defeito fechado em
-- 2026-08-24 (`c56d227`, "a RPC que confia num parâmetro pode fechar"). A identidade vem do JWT
-- da sessão, então esta função PRECISA ser chamada com o cliente do operador e não com o service
-- role — que é como `core.cms_create_place` já funciona.
CREATE OR REPLACE FUNCTION core.cms_set_partner_description_exception(
  p_attraction_id uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions'
AS $$
DECLARE
  v_reason text := btrim(coalesce(p_reason, ''));
  v_uid    uuid := auth.uid();
BEGIN
  IF NOT core.is_active_cms_editor_or_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION 'exception_reason_required' USING ERRCODE = '22023';
  END IF;
  IF v_uid IS NULL THEN
    -- Sem sessão não há autor, e o CHECK da 02 recusaria de qualquer forma. Recusar aqui é o que
    -- dá ao chamador uma palavra em vez de uma violação de constraint.
    RAISE EXCEPTION 'exception_requires_session' USING ERRCODE = '42501';
  END IF;

  UPDATE core.attractions
     SET partner_description_exception_at     = now(),
         partner_description_exception_by     = v_uid,
         partner_description_exception_reason = v_reason
   WHERE id = p_attraction_id;
END;
$$;

-- As três voltam a NULL juntas: meia exceção é o estado que o CHECK da 02 existe para impedir.
-- O QUE ELA NÃO FAZ é apagar a descrição que a exceção produziu — tirar conteúdo publicado do ar
-- é outra decisão, com outra régua (BR-B2B-027), e é do operador.
CREATE OR REPLACE FUNCTION core.cms_clear_partner_description_exception(
  p_attraction_id uuid
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions'
AS $$
BEGIN
  IF NOT core.is_active_cms_editor_or_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE core.attractions
     SET partner_description_exception_at     = NULL,
         partner_description_exception_by     = NULL,
         partner_description_exception_reason = NULL
   WHERE id = p_attraction_id;
END;
$$;

-- 4) O PLANO NO CARD DE LOCAIS ---------------------------------------------------------------
-- Pedido do operador em 2026-08-26: o card precisa dizer se aquele local é pago, pelo contrato a
-- que está ligado. Sete colunas NOVAS, e nenhuma delas é a resposta: são os FATOS que
-- `derivePartnerPlan` já sabe ranquear (contrato > cadastro > proposta). O card imprime o que
-- `paymentStance` devolver.
--
-- ⚠️ A DEFINIÇÃO ABAIXO PARTE DA FUNÇÃO VIVA EM 2026-08-26, não do arquivo `20260703_07` deste
-- repo — o banco estava À FRENTE dele: `partner_client_id_filter`, a coluna `partner_client_id`
-- de saída e `core.name_search_key` no `search_term` entraram por DDL manual e nunca voltaram
-- para uma migration. Recriar a função a partir do arquivo teria apagado as três em silêncio.
-- Quem for mexer nela de novo: leia `pg_get_functiondef` ANTES.
DROP FUNCTION IF EXISTS core.cms_list_places(text, text, text, text, text, text, integer, integer, boolean, uuid);
CREATE FUNCTION core.cms_list_places(
  search_term      text DEFAULT NULL,
  status_filter    text DEFAULT 'all',
  country_filter   text DEFAULT NULL,
  state_filter     text DEFAULT NULL,
  city_filter      text DEFAULT NULL,
  place_type_filter text DEFAULT NULL,
  limit_count      integer DEFAULT 50,
  offset_count     integer DEFAULT 0,
  fetch_all        boolean DEFAULT false,
  partner_client_id_filter uuid DEFAULT NULL
) RETURNS TABLE(
  id uuid, name text, city text, state text, country text,
  approved boolean, is_active boolean, priority_level smallint,
  image_url text, created_at timestamptz, updated_at timestamptz,
  latitude double precision, longitude double precision,
  place_type text, price_range smallint, tags text[], has_hours boolean,
  description_count bigint, trigger_point_count bigint, total_count bigint,
  partner_client_id uuid,
  partner_name text,
  monthly_fee_cents integer,
  is_courtesy boolean,
  courtesy_reason text,
  plan_choice text,
  contract_tier text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions'
AS $$
BEGIN
  -- CMS-only tool (espelha cms_list_pois SECURITY DEFINER). Não-CMS => vazio.
  IF NOT core.is_active_cms_user() THEN RETURN; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT a.id, a.name, a.city, a.state, a.country, a.approved, a.is_active,
           a.priority_level, a.image_url, a.created_at, a.updated_at,
           a.partner_client_id,
           ac.latitude, ac.longitude,
           pd.place_type, pd.price_range, pd.tags,
           (a.opening_hours IS NOT NULL) AS has_hours
    FROM core.attractions a
    JOIN core.place_details pd ON pd.attraction_id = a.id
    LEFT JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
    WHERE a.entity_kind = 'place'
      -- Dono comercial (BR-CMS-002). Igualdade sargável, sem cast nem função em
      -- volta da coluna: é isso que faz o plano custom sair por
      -- `idx_attractions_partner_client_id`. Parâmetro nulo = SEM FILTRO, e o
      -- predicado desaparece do plano. Nulo NÃO significa "sem escopo":
      -- escopo vazio é conjunto vazio, nunca "tudo".
      AND (partner_client_id_filter IS NULL
           OR a.partner_client_id = partner_client_id_filter)
      AND (search_term IS NULL OR core.name_search_key(a.name) LIKE '%' || core.name_search_key(search_term) || '%')
      AND (status_filter = 'all'
           OR (status_filter = 'approved' AND a.approved = true)
           OR (status_filter = 'pending'  AND a.approved = false))
      AND (country_filter    IS NULL OR a.country = country_filter)
      AND (state_filter      IS NULL OR a.state   = state_filter)
      AND (city_filter       IS NULL OR a.city    = city_filter)
      AND (place_type_filter IS NULL OR pd.place_type = place_type_filter)
  ), counted AS (
    SELECT b.*, count(*) OVER() AS total_count FROM base b
  ), page AS (
    -- A PÁGINA PRIMEIRO, e só então o dinheiro. Os LATERAL abaixo custam uma leitura por linha
    -- em três tabelas de `partner`; pendurá-los no `base` os faria rodar sobre TODOS os locais
    -- que casam com o filtro para devolver 50. São 283 locais hoje e ninguém sentiria — mas o
    -- lugar certo de uma junção que só a página usa é depois do LIMIT, e não daqui a um ano.
    SELECT c.*
    FROM counted c
    -- Uma ordenação só, e ela não conhece o dono comercial (BR-B2B-010 item 6).
    ORDER BY c.created_at DESC
    LIMIT CASE WHEN fetch_all THEN NULL ELSE limit_count END
    OFFSET CASE WHEN fetch_all THEN 0 ELSE offset_count END
  )
  SELECT p.id, p.name, p.city, p.state, p.country, p.approved, p.is_active,
         p.priority_level, p.image_url, p.created_at, p.updated_at,
         p.latitude, p.longitude, p.place_type, p.price_range, p.tags, p.has_hours,
         (SELECT count(*) FROM core.attraction_descriptions ad WHERE ad.attraction_id = p.id),
         (SELECT count(*) FROM core.attraction_trigger_points tp WHERE tp.attraction_id = p.id),
         p.total_count,
         p.partner_client_id,
         -- `partner.clients.name` é `character varying`; o cast é obrigatório, senão o
         -- RETURNS TABLE recusa a linha inteira com "structure of query does not match".
         cl.name::text,
         cl.monthly_fee_cents,
         cl.is_courtesy,
         cl.courtesy_reason,
         sub.answers ->> 'plan_choice',
         ct.tier
  FROM page p
  LEFT JOIN partner.clients cl ON cl.id = p.partner_client_id
  LEFT JOIN LATERAL (
    SELECT c2.tier
    FROM partner.partner_contracts c2
    WHERE c2.client_id = p.partner_client_id
      AND c2.superseded_by IS NULL
    ORDER BY c2.created_at DESC
    LIMIT 1
  ) ct ON true
  LEFT JOIN LATERAL (
    SELECT s.answers
    FROM partner.partner_form_submissions s
    WHERE s.promoted_client_id = p.partner_client_id
      AND s.status = 'promoted'
    ORDER BY s.promoted_at DESC
    LIMIT 1
  ) sub ON true
  ORDER BY p.created_at DESC;
END;
$$;

-- 5) PERMISSÕES ------------------------------------------------------------------------------
-- `ALTER DEFAULT PRIVILEGES` desta plataforma concede EXECUTE a `anon` em toda função nova, e
-- PUBLIC não é anon — revogar de PUBLIC não basta. As quatro são ferramentas de CMS: `anon` não
-- executa nenhuma, e as três de escrita ainda checam `is_active_cms_editor_or_admin()` por dentro.
REVOKE ALL ON FUNCTION core.cms_place_description_facts(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.cms_apply_name_only_description(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.cms_set_partner_description_exception(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.cms_clear_partner_description_exception(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.cms_list_places(text, text, text, text, text, text, integer, integer, boolean, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION core.cms_place_description_facts(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.cms_apply_name_only_description(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.cms_set_partner_description_exception(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.cms_clear_partner_description_exception(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.cms_list_places(text, text, text, text, text, text, integer, integer, boolean, uuid) TO authenticated, service_role;

-- 6) O CACHE DE SCHEMA DO POSTGREST ----------------------------------------------------------
-- ⚠️ ISTO NÃO É ZELO: sem esta linha, FUNÇÃO NOVA RESPONDE 404 (`PGRST202`) mesmo existindo.
--
-- Medido em 2026-08-26, e o par de sintomas é o que denuncia. Depois de aplicar esta migration
-- o card de Locais passou a mostrar o plano na hora — `cms_list_places` MUDOU mas manteve nome e
-- assinatura, então a entrada em cache continuou casando. `cms_place_description_facts` é NOVA:
-- não estava no cache, e a aba Descrições ficou sem faixa nenhuma, sem erro visível. O par
-- "uma funciona, a outra não existe" é a assinatura desta armadilha.
--
-- O event trigger da plataforma costuma disparar isto sozinho, mas não em toda execução do SQL
-- Editor. Rodar duas vezes não custa nada, e não rodar custa uma hora de caça.
NOTIFY pgrst, 'reload schema';
