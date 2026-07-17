-- ─────────────────────────────────────────────────────────────────────────────
-- 20260715_02 — invalidar o áudio quando o TEXTO daquele idioma muda
--
-- PROBLEMA
-- O áudio narra a descrição. Quando o texto de uma linha (attraction, language,
-- gender) é editado/regerado, o mp3 existente passa a narrar o texto ANTIGO —
-- mas `audio_url` continua apontando para ele. Resultado no app: mostra o texto
-- novo e TOCA o áudio velho.
--
-- Verificado no código: a EF `generate-description` (745 linhas) NÃO tem uma única
-- menção a áudio — ela regera o texto e não toca no mp3. E `cleanup-orphan-audios`
-- faz o inverso: é um GC que só apaga blobs JÁ não-referenciados por nenhum
-- audio_url. Não existia nada invalidando o áudio na mudança de texto.
--
-- FIX
-- Trigger BEFORE UPDATE por-linha: se o texto mudou, anula `audio_url`. A partir daí
-- a corrente já existente resolve sozinha:
--   1. dirty-queue rebuilda o app_poi_read;
--   2. a linha viaja com audio_url = null (visível graças à 20260715_01, que removeu
--      o FILTER que escondia descrições sem áudio);
--   3. o app mostra o texto novo, não acha áudio no idioma e pede a geração
--      (ListenCard → generate-translated-audio);
--   4. o mp3 órfão é recolhido pelo cron automated_audio_cleanup → cleanup-orphan-audios.
--
-- ESCOPO: só a linha cujo texto mudou (mesmo idioma/gênero). NÃO cascateia para as
-- traduções derivadas — a proveniência está perdida (13.634 de ~18.350 linhas sem
-- generation_kind nem generation_meta) e o idioma-master VARIA por POI (há traduções
-- com source_language pt-br/en-us/en-gb/pt-pt/es-es). Cascatear no chute apagaria
-- masters, que é irrecuperável. O caminho seguro para isso é uma coluna `source_hash`
-- preenchida daqui pra frente — fora do escopo desta migration.
--
-- NÃO faz backfill: texto e áudio dividem o mesmo `updated_at`, então não há como
-- saber quais linhas já estão dessincronizadas. Vale da aplicação em diante.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION core.tg_invalidate_audio_on_description_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Guarda dupla:
  --  • só age se o texto REALMENTE mudou (IS DISTINCT FROM cobre NULL);
  --  • e só se o audio_url NÃO estiver sendo setado no MESMO UPDATE — senão
  --    apagaríamos o áudio que a generate-translated-audio acabou de gravar
  --    (ela escreve description + audio_url na mesma operação).
  IF NEW.description IS DISTINCT FROM OLD.description
     AND NEW.audio_url IS NOT DISTINCT FROM OLD.audio_url THEN
    NEW.audio_url := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invalidate_audio_on_description_change
  ON core.attraction_descriptions;

CREATE TRIGGER invalidate_audio_on_description_change
  BEFORE UPDATE OF description ON core.attraction_descriptions
  FOR EACH ROW
  EXECUTE FUNCTION core.tg_invalidate_audio_on_description_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO (numa linha de teste, fora de pico):
--   -- antes: audio_url preenchida
--   SELECT language, audio_url IS NOT NULL AS tem_audio FROM core.attraction_descriptions
--    WHERE id = '<row_id>';
--   -- edita o texto:
--   UPDATE core.attraction_descriptions SET description = description || ' .'
--    WHERE id = '<row_id>';
--   -- depois: audio_url deve estar NULL, e o app deve pedir só o áudio ao abrir.
--   SELECT language, audio_url IS NOT NULL AS tem_audio FROM core.attraction_descriptions
--    WHERE id = '<row_id>';
--
-- NÃO-REGRESSÃO (a generate-translated-audio deve continuar gravando áudio):
--   UPDATE core.attraction_descriptions
--      SET description = 'novo texto', audio_url = 'https://.../novo.mp3'
--    WHERE id = '<row_id>';
--   -- audio_url deve PERMANECER preenchida (a guarda do mesmo-UPDATE protege).
-- ─────────────────────────────────────────────────────────────────────────────
