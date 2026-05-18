-- Adiciona suporte a TPs do tipo 'geofence' (issue 2.4 da análise do motor de geração).
--
-- Motivação: usuários caminhando entram pela porta principal/lateral do POI
-- (museu, prédio, parque) sem passar próximos aos TPs `arrival` na rua. Sem
-- um geofence-TP nada dispara. O app `tuggi-drive-v2` já suporta type='geofence'
-- com polígono GeoJSON; aqui adicionamos suporte do lado do CMS.
--
-- Mudanças:
--  1. Diagnóstica e normaliza tipos legados não-conformes
--  2. Expande a CHECK constraint para incluir 'geofence' + valores legados
--     que aparecem em produção mas não estavam no constraint original
--     ('secondary', 'special', 'testing' — emitidos pelo código antigo)
--  3. Adiciona a coluna `geometry_geojson` (texto GeoJSON) para o polígono

-- Diagnóstico: log dos tipos atualmente existentes para auditoria
DO $$
DECLARE
  rec record;
BEGIN
  RAISE NOTICE '--- attraction_trigger_points.type distribution before migration ---';
  FOR rec IN
    SELECT type, count(*) AS n FROM core.attraction_trigger_points GROUP BY type ORDER BY n DESC
  LOOP
    RAISE NOTICE '  type=%, count=%', rec.type, rec.n;
  END LOOP;
END $$;

-- Normaliza qualquer tipo NULO ou completamente desconhecido para 'primary'.
-- Mantemos 'secondary', 'special' e 'testing' (legados emitidos pelo código TS)
-- expandindo o constraint para aceitá-los — não há perda de dados.
UPDATE core.attraction_trigger_points
SET type = 'primary'
WHERE type IS NULL
   OR type NOT IN (
        'primary', 'fallback', 'entry', 'exit', 'approach', 'custom',
        'secondary', 'special', 'testing'
      );

-- Expande o CHECK constraint (drop+recreate)
ALTER TABLE core.attraction_trigger_points
  DROP CONSTRAINT IF EXISTS attraction_trigger_points_type_check;

ALTER TABLE core.attraction_trigger_points
  ADD CONSTRAINT attraction_trigger_points_type_check
  CHECK (type IN (
    'primary', 'secondary', 'fallback', 'special', 'testing',
    'entry', 'exit', 'approach', 'custom',
    'geofence'
  ));

-- Coluna do polígono
ALTER TABLE core.attraction_trigger_points
  ADD COLUMN IF NOT EXISTS geometry_geojson text;

COMMENT ON COLUMN core.attraction_trigger_points.geometry_geojson IS
  'GeoJSON Polygon que define a área de disparo para TPs do tipo geofence. '
  'Usado pelo app tuggi-drive-v2 para detectar entrada no polígono (sem bearing).';

COMMENT ON COLUMN core.attraction_trigger_points.type IS
  'Type of trigger: primary, secondary, fallback, special, testing, entry, exit, approach, custom, geofence';
