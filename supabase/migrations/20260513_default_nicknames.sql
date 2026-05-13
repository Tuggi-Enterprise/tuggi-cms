-- Migration: Default nicknames + unicidade
-- Date: 2026-05-13
-- Description:
--   Toda a logica de geracao de nickname default vive aqui. O app nunca
--   gera nickname; ele apenas le profile.nickname.
--
--   1. Funcao drive.generate_default_nickname(language) — combina um
--      substantivo + adjetivo + numero 4 digitos, por idioma. Loop
--      com checagem de colisao; fallback em uuid suffix se estourar.
--   2. Trigger BEFORE INSERT em drive.profiles que atribui o default
--      caso o nickname venha NULL/vazio.
--   3. Backfill para profiles existentes sem nickname.
--   4. UNIQUE constraint em nickname (apos backfill).
--
--   Fallback de idioma quando profile.language eh NULL/desconhecido: 'en'
--   (mais universal globalmente).

-- ============================================
-- 1. Funcao geradora
-- ============================================
CREATE OR REPLACE FUNCTION drive.generate_default_nickname(p_language TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_lang TEXT;
  v_nouns TEXT[];
  v_adjs TEXT[];
  v_noun TEXT;
  v_adj TEXT;
  v_num INT;
  v_nickname TEXT;
  v_exists BOOLEAN;
  v_attempts INT := 0;
BEGIN
  -- Normaliza idioma. Qualquer coisa fora da lista cai em 'en'.
  v_lang := CASE
    WHEN p_language IN ('pt-br', 'pt-pt', 'pt') THEN 'pt'
    WHEN p_language = 'es' THEN 'es'
    WHEN p_language = 'it' THEN 'it'
    ELSE 'en'
  END;

  IF v_lang = 'pt' THEN
    v_nouns := ARRAY['Andarilho','Nomade','Viajante','Explorador','Caminhante','Peregrino','Forasteiro','Navegante','Desbravador','Aventureiro'];
    v_adjs  := ARRAY['Curioso','Aventureiro','Solitario','Sonhador','Veloz','Tranquilo','Destemido','Errante','Selvagem','Mistico'];
  ELSIF v_lang = 'es' THEN
    v_nouns := ARRAY['Caminante','Nomada','Viajero','Explorador','Andariego','Peregrino','Navegante','Aventurero','Descubridor','Forastero'];
    v_adjs  := ARRAY['Curioso','Aventurero','Solitario','Sonador','Veloz','Tranquilo','Audaz','Errante','Salvaje','Mistico'];
  ELSIF v_lang = 'it' THEN
    v_nouns := ARRAY['Viandante','Nomade','Viaggiatore','Esploratore','Cercatore','Pellegrino','Navigante','Avventuriero','Pioniere','Forestiero'];
    v_adjs  := ARRAY['Curioso','Avventuroso','Solitario','Sognatore','Veloce','Tranquillo','Audace','Errante','Selvaggio','Mistico'];
  ELSE
    v_nouns := ARRAY['Wanderer','Nomad','Traveler','Explorer','Pathfinder','Pilgrim','Voyager','Navigator','Adventurer','Pioneer'];
    v_adjs  := ARRAY['Curious','Adventurous','Solitary','Dreamy','Swift','Calm','Bold','Wandering','Wild','Mystic'];
  END IF;

  LOOP
    v_noun := v_nouns[1 + floor(random() * array_length(v_nouns, 1))::INT];
    v_adj  := v_adjs[1 + floor(random() * array_length(v_adjs, 1))::INT];
    v_num  := 1000 + floor(random() * 9000)::INT;
    v_nickname := v_noun || v_adj || v_num::TEXT;

    SELECT EXISTS(SELECT 1 FROM drive.profiles WHERE nickname = v_nickname) INTO v_exists;
    EXIT WHEN NOT v_exists;

    v_attempts := v_attempts + 1;
    IF v_attempts >= 20 THEN
      v_nickname := v_nickname || substr(gen_random_uuid()::TEXT, 1, 4);
      EXIT;
    END IF;
  END LOOP;

  RETURN v_nickname;
END;
$$;

COMMENT ON FUNCTION drive.generate_default_nickname(TEXT) IS
  'Generates a unique default nickname (Noun + Adjective + 4-digit number) localized by language. Fallback language is English. Unique per call via collision retry.';

-- ============================================
-- 2. Trigger BEFORE INSERT
-- ============================================
CREATE OR REPLACE FUNCTION drive.tg_assign_default_nickname()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.nickname IS NULL OR NEW.nickname = '' THEN
    NEW.nickname := drive.generate_default_nickname(COALESCE(NEW.language, 'en'));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_assign_default_nickname ON drive.profiles;
CREATE TRIGGER tr_assign_default_nickname
  BEFORE INSERT ON drive.profiles
  FOR EACH ROW
  EXECUTE FUNCTION drive.tg_assign_default_nickname();

COMMENT ON TRIGGER tr_assign_default_nickname ON drive.profiles IS
  'Auto-assigns a localized default nickname when a profile is inserted without one. Idempotent — does not touch nicknames already set.';

-- ============================================
-- 3. Backfill (profiles existentes sem nickname)
-- ============================================
UPDATE drive.profiles
SET nickname = drive.generate_default_nickname(COALESCE(language, 'en'))
WHERE nickname IS NULL OR nickname = '';

-- ============================================
-- 4. UNIQUE constraint
-- ============================================
-- Defesa antes do constraint: caso o app tenha gravado duplicatas via race
-- condition, anexa um sufixo aleatorio nas mais novas pra desempatar.
WITH dupes AS (
  SELECT id,
         nickname,
         ROW_NUMBER() OVER (PARTITION BY nickname ORDER BY created_at ASC) AS rn
  FROM drive.profiles
  WHERE nickname IS NOT NULL
)
UPDATE drive.profiles p
SET nickname = p.nickname || substr(gen_random_uuid()::TEXT, 1, 4)
FROM dupes d
WHERE p.id = d.id AND d.rn > 1;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_nickname_unique'
      AND conrelid = 'drive.profiles'::regclass
  ) THEN
    ALTER TABLE drive.profiles
      ADD CONSTRAINT profiles_nickname_unique UNIQUE (nickname);
  END IF;
END $constraint$;
