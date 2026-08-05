-- Recalcula boundary_area_m2 a partir da própria geometria.
--
-- calculatePolygonArea somava (lng, lat) em radianos como se fosse plano cartesiano, sem
-- estreitar os meridianos conforme a latitude cresce. O resultado era inflado por exatamente
-- 1/cos(latitude): nulo no equador, 33% em Barcelona, o dobro perto do círculo polar.
-- Medido antes deste fix: 21.213 m² gravados para 15.933 m² reais na Sagrada Família e
-- 27.448 para 20.621 na Plaça de Catalunya — 1,331× nos dois, e 1/cos(41,4°) = 1,3331.
--
-- A função foi corrigida para excesso esférico em lib/utils/geometry.ts e na cópia da Edge
-- Function, com paridade coberta por tests/api/geometry-area.test.ts. Falta corrigir o que
-- já está gravado: 179 linhas, fator médio de inflação 1,106 (menor no Brasil, que está mais
-- perto do equador).
--
-- ST_Area(geography) é a autoridade aqui — mede sobre o esferoide WGS84, não sobre esfera.
--
-- Rollback: não há valor anterior guardado, e não vale guardar — o valor anterior estava
-- errado por construção. Para reverter, basta não rodar.

BEGIN;

UPDATE core.attraction_coordinate
SET boundary_area_m2 = ROUND(ST_Area(boundary_geometry)::numeric),
    updated_at = now()
WHERE boundary_area_m2 IS NOT NULL
  AND boundary_geometry IS NOT NULL
  AND abs(boundary_area_m2 - ST_Area(boundary_geometry)) > 1;

COMMIT;

-- Verificação — esperado: fator_medio = 1.0000 e divergentes = 0.
--   SELECT count(*) FILTER (WHERE abs(boundary_area_m2 - ST_Area(boundary_geometry)) > 1) AS divergentes,
--          round(avg(boundary_area_m2 / nullif(ST_Area(boundary_geometry), 0))::numeric, 4) AS fator_medio
--   FROM core.attraction_coordinate
--   WHERE boundary_area_m2 IS NOT NULL AND boundary_geometry IS NOT NULL;
