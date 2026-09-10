-- ============================================================================
-- O opt-out de push para de vazar — e o vazamento era ATIVO, não passivo
-- ----------------------------------------------------------------------------
-- VEREDITO, medido no banco em 2026-09-10 (o briefing pedia qual dos dois casos
-- era o nosso; é o pior dos dois, e por um mecanismo que não estava na lista):
--
--   `drive.unregister_fcm_token` não zera `drive.profiles.push_token` — mas o
--   problema não é a omissão. Existe um gatilho:
--
--     CREATE TRIGGER trigger_sync_fcm_token
--       AFTER INSERT OR UPDATE ON drive.fcm_tokens
--       FOR EACH ROW EXECUTE FUNCTION drive.sync_fcm_token_to_profile();
--
--   e o corpo dele é `UPDATE drive.profiles SET push_token = NEW.fcm_token`,
--   SEM olhar `NEW.is_active`.
--
--   `unregister_fcm_token` faz `UPDATE drive.fcm_tokens SET is_active = false`.
--   Esse UPDATE **dispara o gatilho**. O gatilho **reescreve o token** em
--   `profiles.push_token`. Na MESMA transação em que o turista desliga o push,
--   o banco REARMA o ramo que ignora a preferência.
--
--   Não é "o opt-out se desfaz no próximo cold start". É: o opt-out NUNCA
--   chegou a existir. `core.get_audience_push_tokens` une
--     ramo 1: fcm_tokens WHERE is_active = true          → respeita o desligar
--     ramo 2: profiles.push_token IS NOT NULL            → sem condição nenhuma
--   e o ramo 2 recebe o token de volta pelas mãos do próprio desligar.
--
--   DANO MEDIDO: 30 perfis com TODOS os fcm_tokens inativos e `push_token`
--   ainda preenchido — 30 pessoas que desligaram na tela e continuam recebendo.
--   Mais 20 com `push_denied = true` (negaram no sistema operacional). 522
--   perfis no total. Isto é conformidade de loja e de LGPD/GDPR sobre o app
--   inteiro, não estética de schema.
--
-- FATO QUE MUDOU O DESENHO: `push_notifications_enabled` NUNCA foi coluna de
-- `drive.profiles` (confirmado) e saiu da allowlist de `drive.update_profile_v1`
-- justamente por isso — a tela do app grava a chave e a RPC a DESCARTA EM
-- SILÊNCIO (a armadilha nomeada em `docs/contracts/app-para-banco.md`). Existe
-- `drive.profiles.notifications_opt_in`, mas é `jsonb`, está NULL em 522 de 522
-- e nenhuma função no banco a lê ou escreve: é órfã, não é a preferência
-- (CLAUDE.md §6 — "nome que mente"). Ela NÃO é reaproveitada aqui.
--
-- Por isso coluna + allowlist + os DOIS resolvedores + o gatilho vêm no MESMO
-- commit, e `docs/contracts/app-para-banco.md` é atualizado junto (gatilho §2).
--
-- ⚠️  Gatilho §2: mexe em dado pessoal e em consentimento →
--     `security-reviewer` ANTES do merge.
-- ⚠️  Rodar manualmente no SQL editor do painel (DDL nunca via CLI).
-- ============================================================================

-- ─────────────────────────────── UP ────────────────────────────────────────
BEGIN;

-- ----------------------------------------------------------------------------
-- 1. A preferência, com nome que não mente e um dono só (SSOT)
-- ----------------------------------------------------------------------------
ALTER TABLE drive.profiles
    ADD COLUMN IF NOT EXISTS push_notifications_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN drive.profiles.push_notifications_enabled IS
  'SSOT do consentimento de push. `false` = o turista desligou NA TELA. Distinto de push_denied, que é a recusa no SISTEMA OPERACIONAL: uma pessoa pode ter concedido no SO e desligado no app. TODO resolvedor de audiência de push le esta coluna E push_denied.';

-- Retroação a partir do único fato observável que sobrou: quem desativou seus
-- tokens já disse não, e quem negou no SO também. 50 linhas esperadas
-- (20 push_denied + 30 opt-out pelo app), medidas em 2026-09-10.
-- `DEFAULT true` só vale para quem nunca se manifestou — que é o estado de
-- fato de quem aceitou o prompt do sistema e nunca mexeu.
UPDATE drive.profiles p
   SET push_notifications_enabled = false,
       updated_at = now()
 WHERE p.push_denied IS TRUE
    OR (    EXISTS (SELECT 1 FROM drive.fcm_tokens t WHERE t.user_id = p.id AND t.is_active = false)
        AND NOT EXISTS (SELECT 1 FROM drive.fcm_tokens t WHERE t.user_id = p.id AND t.is_active = true));

-- Limpa o token dos 50 no mesmo passo: enquanto ele estiver lá, qualquer
-- consulta que esqueça o predicado volta a vazar.
UPDATE drive.profiles p
   SET push_token = NULL,
       updated_at = now()
 WHERE p.push_notifications_enabled = false
   AND p.push_token IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. O gatilho que rearmava o vazamento
-- ----------------------------------------------------------------------------
-- Passa a DERIVAR `profiles.push_token` dos tokens ATIVOS do usuário, em vez de
-- copiar cegamente o último que passou. Três consequências, todas desejadas:
--   • desativar o único token zera a coluna (fim do rearme);
--   • aparelho A ativo + aparelho B desativado mantém o token de A — a cópia
--     cega zerava (ou reescrevia com B) e mentia sobre os dois;
--   • DELETE passa a contar (`register_fcm_token` apaga linhas), e antes não.
CREATE OR REPLACE FUNCTION drive.sync_fcm_token_to_profile()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'drive', 'public', 'extensions'
AS $function$
DECLARE
  v_uid uuid;
BEGIN
  -- TG_OP explícito: em DELETE o registro NEW não está atribuído, e ler campo
  -- dele é dependência de detalhe do PL/pgSQL que não vale a economia.
  IF TG_OP = 'DELETE' THEN
    v_uid := OLD.user_id;
  ELSE
    v_uid := NEW.user_id;
  END IF;

  UPDATE drive.profiles p
     SET push_token = (
           SELECT t.fcm_token
             FROM drive.fcm_tokens t
            WHERE t.user_id = v_uid
              AND t.is_active = true
            ORDER BY t.updated_at DESC NULLS LAST
            LIMIT 1
         ),
         updated_at = now()
   WHERE p.id = v_uid;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_sync_fcm_token ON drive.fcm_tokens;
CREATE TRIGGER trigger_sync_fcm_token
    AFTER INSERT OR UPDATE OR DELETE ON drive.fcm_tokens
    FOR EACH ROW EXECUTE FUNCTION drive.sync_fcm_token_to_profile();

-- ----------------------------------------------------------------------------
-- 3. Desligar grava a PREFERÊNCIA, não só o token
-- ----------------------------------------------------------------------------
-- Corpo lido do banco em 2026-09-10 e preservado; o que entra é a escrita da
-- preferência. Sem ela, `AuthManager.updateFCMToken` re-registra no próximo
-- login e o desligar evapora — o token é estado do aparelho, a preferência é
-- estado da pessoa, e só a segunda sobrevive a uma reinstalação.
CREATE OR REPLACE FUNCTION drive.unregister_fcm_token(p_device_id text DEFAULT NULL::text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'drive'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  UPDATE drive.fcm_tokens
     SET is_active = false, updated_at = now()
   WHERE user_id = v_uid
     AND (p_device_id IS NULL OR device_id = p_device_id);

  -- Desligar UM aparelho não é desligar a pessoa. A preferência só cai quando
  -- não sobra nenhum aparelho ativo — que é o caso do botão de Ajustes, o
  -- único chamador de fato (`unregisterFCMToken`, chamado sem device_id).
  UPDATE drive.profiles p
     SET push_notifications_enabled = false,
         updated_at = now()
   WHERE p.id = v_uid
     AND NOT EXISTS (SELECT 1 FROM drive.fcm_tokens t
                      WHERE t.user_id = v_uid AND t.is_active = true);

  RETURN true;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. Re-registrar NÃO é re-consentir
-- ----------------------------------------------------------------------------
-- `AuthManager.updateFCMToken` chama esta função no login e na restauração de
-- sessão, com um portão só (permissão do SO + push_denied) e sem consultar
-- preferência nenhuma. Se ela reativasse o token, o cold start desfaria o
-- opt-out — e o app não precisa mudar uma linha para isso parar: o token é
-- gravado (o aparelho pode ter mudado), mas nasce INATIVO enquanto a pessoa
-- disser não. Reativar é ato explícito, e o ato é `update_profile_v1`.
CREATE OR REPLACE FUNCTION drive.register_fcm_token(p_fcm_token text, p_device_id text, p_device_info jsonb DEFAULT '{}'::jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'drive'
AS $function$
DECLARE
  v_uid    UUID;
  v_active BOOLEAN;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR p_fcm_token IS NULL OR p_device_id IS NULL THEN
    RETURN false;
  END IF;

  -- A preferência da PESSOA decide se o token do APARELHO vale.
  SELECT COALESCE(p.push_notifications_enabled, true) AND COALESCE(p.push_denied, false) = false
    INTO v_active
    FROM drive.profiles p
   WHERE p.id = v_uid;
  v_active := COALESCE(v_active, true);

  -- 1. Release this token from any other owner (device changed user).
  DELETE FROM drive.fcm_tokens
  WHERE fcm_token = p_fcm_token AND user_id <> v_uid;

  -- 2. Clear a stale token for this (user, device) so the composite UNIQUE
  --    (user_id, device_id) doesn't collide with the upsert.
  DELETE FROM drive.fcm_tokens
  WHERE user_id = v_uid AND device_id = p_device_id AND fcm_token <> p_fcm_token;

  -- 3. Upsert the token, owned by the caller.
  INSERT INTO drive.fcm_tokens (user_id, fcm_token, device_id, device_info, is_active)
  VALUES (v_uid, p_fcm_token, p_device_id, COALESCE(p_device_info, '{}'::jsonb), v_active)
  ON CONFLICT (fcm_token) DO UPDATE SET
    user_id     = v_uid,
    device_id   = EXCLUDED.device_id,
    device_info = EXCLUDED.device_info,
    is_active   = v_active,
    updated_at  = NOW();

  RETURN true;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5. A allowlist do perfil — coluna e chave no MESMO commit
-- ----------------------------------------------------------------------------
-- Corpo lido do banco em 2026-09-10 e preservado inteiro. A ÚNICA mudança é a
-- entrada `push_notifications_enabled` na `v_allow`. A função monta o UPDATE de
-- três condições (chave na allowlist + presente no patch + coluna real) e
-- descarta sem erro o que falha qualquer uma — é o defeito #719, e é por isso
-- que a coluna do item 1 e esta linha não podem viajar separadas.
CREATE OR REPLACE FUNCTION drive.update_profile_v1(p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'drive'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  -- the ONLY columns the client may write (if they exist on the table)
  v_allow text[] := ARRAY[
    'full_name','nickname','avatar_url','phone',
    'last_platform','last_device_model','last_app_version','last_sign_in_at',
    'driver_type','latitude','longitude','language','push_token','timezone',
    'login_count','ip_address','push_denied',
    'voice_preference','voice_language','trigger_radius',
    -- BR-USUARIO-043: os sete campos da coleta demográfica (#720). Fora desta
    -- lista a chave é descartada SEM ERRO, que é o defeito #719.
    'country','spoken_languages','age_range','gender',
    'travel_modes','travel_party','travel_frequency',
    -- Consentimento de push. A chave já era mandada pelo app publicado e caía
    -- no vazio porque a coluna não existia; ela existe desde 2026-09-10 e esta
    -- linha é o que faz o botão de Ajustes finalmente gravar.
    'push_notifications_enabled'
  ];
  v_set      text := '';
  v_key      text;
  v_udt      text;
  v_is_array boolean;
  v_nick     text;
  v_row      drive.profiles;
  v_tier     jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- BR-USUARIO-046: o apelido é obrigatório e não se repete (decisão do
  -- operador em 2026-09-08, que fecha o 1º caso de borda da regra).
  --
  -- Recusa a CHAMADA INTEIRA, e não a chave: descartar `nickname` em silêncio
  -- faria a tela do app publicado dizer "salvo" para uma escrita que não
  -- aconteceu — o defeito #719, e a armadilha conhecida justamente desta
  -- função. O app antigo (1.3.x, 1.4.x) manda `nickname: null` quando o
  -- turista apaga o campo; com a recusa ele cai no `catch` de `handleSave`,
  -- a tela PERMANECE com o que foi digitado e nada se perde além da gravação
  -- daquele toque.
  --
  -- O `btrim` grava o mesmo valor que foi conferido: a unicidade vive em
  -- `lower(btrim(nickname))` (índice `profiles_nickname_lower_unique`), então
  -- guardar " Foo " faria o rótulo exibido diferir do rótulo que decide
  -- colisão. Duplicata NÃO é checada aqui de propósito — quem garante é o
  -- índice, e o `23505` que ele levanta chega ao cliente como 409.
  IF p_patch ? 'nickname' THEN
    v_nick := btrim(p_patch ->> 'nickname');
    IF v_nick IS NULL OR v_nick = '' THEN
      RAISE EXCEPTION 'TGU46: nickname is required and cannot be emptied'
        USING ERRCODE = 'TGU46',
              HINT = 'Send a non-empty nickname, or omit the key to keep the current one.';
    END IF;
    p_patch := jsonb_set(p_patch, '{nickname}', to_jsonb(v_nick));
  END IF;

  -- ensure the caller's row exists
  INSERT INTO drive.profiles (id) VALUES (v_uid) ON CONFLICT (id) DO NOTHING;

  -- build the SET list from allowlisted keys that are present in the patch AND
  -- exist as real columns. udt_name is the cast target (handles varchar, float8,
  -- timestamptz, bool, enums, …). format() quoting keeps this injection-safe.
  FOR v_key, v_udt, v_is_array IN
    SELECT c.column_name, c.udt_name, (c.data_type = 'ARRAY')
    FROM information_schema.columns c
    WHERE c.table_schema = 'drive'
      AND c.table_name   = 'profiles'
      AND c.column_name  = ANY (v_allow)
      AND p_patch ? c.column_name
  LOOP
    IF v_is_array THEN
      -- CONJUNTO (BR-USUARIO-044 item 2). O caminho escalar não serve: para
      -- text[] o udt_name é `_text` e `->>` de um array JSON devolve o TEXTO
      -- `["car"]`, que não é literal de array — 22P02 em tempo de execução, e
      -- o turista perderia o salvamento inteiro por causa de um campo.
      --   array -> conjunto sem repetição e ordenado (ordem não carrega
      --            significado; canônico só para o valor gravado ser comparável)
      --   []    -> NULL, porque "nenhum marcado" É a ausência e ela tem UMA
      --            representação só
      --   null  -> limpa a coluna (o turista desmarcou tudo)
      --   outro -> descarta em silêncio, igual ao que esta função já faz com
      --            chave fora da allowlist
      v_set := v_set || format(
        '%1$I = CASE jsonb_typeof($1 -> %2$L) '
          'WHEN ''array'' THEN NULLIF('
            'ARRAY(SELECT DISTINCT e FROM jsonb_array_elements_text($1 -> %2$L) AS t(e) ORDER BY e), '
            'ARRAY[]::text[])::%3$I '
          'WHEN ''null'' THEN NULL '
          'ELSE %1$I END, ',
        v_key, v_key, v_udt);
    ELSE
      v_set := v_set || format('%I = ($1 ->> %L)::%I, ', v_key, v_key, v_udt);
    END IF;
  END LOOP;

  IF v_set <> '' THEN
    EXECUTE format(
      'UPDATE drive.profiles SET %s updated_at = now() WHERE id = $2',
      v_set
    ) USING p_patch, v_uid;
  ELSE
    -- nothing writable in the patch -> just touch / ensure-exists
    UPDATE drive.profiles SET updated_at = now() WHERE id = v_uid;
  END IF;

  -- Desligar pela tela de Ajustes desativa os tokens no mesmo ato. Sem isto a
  -- preferência ficaria `false` com o token ainda ativo, e o ramo 1 do
  -- resolvedor continuaria entregando — o mesmo defeito, do outro lado.
  IF p_patch ? 'push_notifications_enabled'
     AND (p_patch ->> 'push_notifications_enabled')::boolean IS FALSE THEN
    UPDATE drive.fcm_tokens
       SET is_active = false, updated_at = now()
     WHERE user_id = v_uid AND is_active = true;
  END IF;

  -- return the row in the shape the app read before: { ...row, tier: { name } }
  SELECT * INTO v_row FROM drive.profiles WHERE id = v_uid;

  SELECT jsonb_build_object('name', st.name) INTO v_tier
  FROM drive.subscription_tiers st
  WHERE st.id = v_row.subscription_tier_id;

  RETURN to_jsonb(v_row) || jsonb_build_object('tier', v_tier);
END;
$function$;

-- ----------------------------------------------------------------------------
-- 6. Os DOIS ramos do resolvedor honrando a MESMA preferência
-- ----------------------------------------------------------------------------
-- Corpo lido do banco (tem `assert_platform_admin` e `search_path`, que o
-- arquivo `20260628_audience_filter_ssot.sql` NÃO tem — recriar dali teria
-- apagado o portão de admin).
-- O predicado do consentimento é escrito UMA vez, na variável, e colado nos
-- dois ramos: dois textos diferentes é como o ramo 2 nasceu sem condição.
CREATE OR REPLACE FUNCTION core.get_audience_push_tokens(p_filters jsonb)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_where   TEXT := core.build_audience_filter(p_filters);
    v_consent TEXT := ' AND p.push_notifications_enabled = true AND p.push_denied IS NOT TRUE ';
    v_tokens  TEXT[];
BEGIN
  PERFORM core.assert_platform_admin();
    EXECUTE format($q$
        SELECT array_agg(DISTINCT tok)
          FROM (
                SELECT t.fcm_token AS tok
                  FROM drive.profiles p
                  JOIN drive.fcm_tokens t ON t.user_id = p.id
                 WHERE t.is_active = true %2$s %1$s
                UNION
                SELECT p.push_token AS tok
                  FROM drive.profiles p
                 WHERE p.push_token IS NOT NULL %2$s %1$s
               ) s
         WHERE tok IS NOT NULL AND tok <> ''
    $q$, v_where, v_consent)
    INTO v_tokens;

    RETURN COALESCE(v_tokens, ARRAY[]::TEXT[]);
END;
$function$;

GRANT EXECUTE ON FUNCTION core.get_audience_push_tokens(jsonb) TO service_role;

-- A estimativa tem de contar a MESMA gente que o envio alcança (SSOT). Hoje ela
-- só olha o ramo 1 — então dizia MENOS do que saía, e o operador aprovava um
-- número que não era o número. Passa a espelhar o resolvedor, ramo a ramo.
-- (O portão de admin do item 7 desta rodada entra aqui junto: sem ele, qualquer
--  usuário logado do app conta o tamanho da nossa base.)
CREATE OR REPLACE FUNCTION core.estimate_notification_audience(p_filters jsonb)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_where   TEXT := core.build_audience_filter(p_filters);
    v_consent TEXT := ' AND p.push_notifications_enabled = true AND p.push_denied IS NOT TRUE ';
    v_count   BIGINT;
BEGIN
    PERFORM core.assert_platform_admin();
    EXECUTE format($q$
        SELECT count(*) FROM (
            SELECT p.id
              FROM drive.profiles p
             WHERE ( EXISTS (SELECT 1 FROM drive.fcm_tokens t
                              WHERE t.user_id = p.id AND t.is_active = true)
                     OR p.push_token IS NOT NULL )
               %2$s %1$s
        ) s
    $q$, v_where, v_consent)
    INTO v_count;
    RETURN COALESCE(v_count, 0);
END;
$function$;

GRANT EXECUTE ON FUNCTION core.estimate_notification_audience(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION core.estimate_notification_audience(jsonb) TO service_role;

-- Índice do predicado de consentimento. A audiência é varrida inteira a cada
-- estimativa e a cada envio; sem ele o filtro novo é um seq scan a mais.
CREATE INDEX IF NOT EXISTS profiles_push_reachable_idx
    ON drive.profiles (id)
    WHERE push_notifications_enabled = true AND push_denied IS NOT TRUE;

COMMIT;

-- ─────────────────────────────── DOWN ──────────────────────────────────────
-- ⚠️  Reverter isto RELIGA o vazamento. Só faz sentido se a migration quebrar
--     o envio; nesse caso reverta os itens 6 e 2 e deixe a coluna, que é inerte
--     sozinha.
-- BEGIN;
--   DROP INDEX IF EXISTS drive.profiles_push_reachable_idx;
--
--   CREATE OR REPLACE FUNCTION drive.sync_fcm_token_to_profile()
--   RETURNS trigger LANGUAGE plpgsql SET search_path TO 'drive','public','extensions'
--   AS $$ BEGIN
--     UPDATE drive.profiles SET push_token = NEW.fcm_token, updated_at = now()
--      WHERE id = NEW.user_id;
--     RETURN NEW;
--   END; $$;
--   DROP TRIGGER IF EXISTS trigger_sync_fcm_token ON drive.fcm_tokens;
--   CREATE TRIGGER trigger_sync_fcm_token AFTER INSERT OR UPDATE ON drive.fcm_tokens
--     FOR EACH ROW EXECUTE FUNCTION drive.sync_fcm_token_to_profile();
--
--   -- os itens 3, 4, 5 e 6 voltam colando o `pg_get_functiondef` capturado
--   -- ANTES do UP (o passo 0 de docs/dev/push-optout-vazamento-2026-09.md).
--   --
--   -- A coluna NÃO é dropada no down: `push_token` já foi zerado para 50
--   -- pessoas com base nela, e dropá-la apagaria o consentimento sem devolver
--   -- o token. Se for mesmo para sumir, é ação destrutiva e o operador executa.
-- COMMIT;
