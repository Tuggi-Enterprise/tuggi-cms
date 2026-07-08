-- ============================================================================
-- BACKFILL — coordenada para eventos criados SEM clique no mapa
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor).
--
-- Diagnóstico (20260706_05) revelou que a maioria dos eventos tem
-- has_coordinate=false → o INNER JOIN em core.attraction_coordinate na
-- app_get_nearby_events os exclui. Este backfill dá a cada evento SEM coordenada
-- o CENTROIDE dos POIs da mesma cidade/país (aproximação: aparecem perto do centro
-- da cidade). É um STOPGAP — o ideal é editar a localização precisa de cada evento
-- no CMS (ver follow-up abaixo).
--
-- Seguro e idempotente: só insere onde NÃO existe coordenada e onde há centroide.
-- location_geography é GENERATED a partir de lat/lng (nada mais a preencher).
-- ============================================================================

-- (Opcional) Prévia — quantos serão backfillados e para onde:
-- SELECT e.name, e.city, cc.lat, cc.lng
-- FROM core.attractions e
-- CROSS JOIN LATERAL (
--   SELECT avg(pc.latitude) lat, avg(pc.longitude) lng
--   FROM core.attractions p JOIN core.attraction_coordinate pc ON pc.attraction_id = p.id
--   WHERE p.entity_kind='poi' AND p.city = e.city AND p.country = e.country
-- ) cc
-- WHERE e.entity_kind='event' AND cc.lat IS NOT NULL
--   AND NOT EXISTS (SELECT 1 FROM core.attraction_coordinate x WHERE x.attraction_id = e.id);

INSERT INTO core.attraction_coordinate (attraction_id, latitude, longitude, show_in_map)
SELECT e.id, cc.lat, cc.lng, true
FROM core.attractions e
CROSS JOIN LATERAL (
  SELECT round(avg(pc.latitude)::numeric, 6)::double precision  AS lat,
         round(avg(pc.longitude)::numeric, 6)::double precision AS lng
  FROM core.attractions p
  JOIN core.attraction_coordinate pc ON pc.attraction_id = p.id
  WHERE p.entity_kind = 'poi'
    AND p.city = e.city
    AND p.country = e.country
) cc
WHERE e.entity_kind = 'event'
  AND cc.lat IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM core.attraction_coordinate x WHERE x.attraction_id = e.id
  );

-- Verificação: quantos eventos AINDA sem coordenada (cidade sem POIs → precisam
-- de localização manual no CMS):
-- SELECT e.name, e.city
-- FROM core.attractions e
-- WHERE e.entity_kind='event'
--   AND NOT EXISTS (SELECT 1 FROM core.attraction_coordinate x WHERE x.attraction_id = e.id);

-- ────────────────────────────────────────────────────────────────────────────
-- FOLLOW-UP (root cause, fora do SQL): no CMS, o LocationPicker é read-only no
-- modo de EDIÇÃO (EventFormModal/PlaceFormModal editable={!isEdit}) e a coordenada
-- NÃO é validada na criação. Por isso eventos nascem sem localização e não há como
-- corrigir depois pela UI. Corrigir: (a) tornar coordenada obrigatória ao criar e
-- (b) permitir editar a localização no modo de edição (+ upsert em
-- attraction_coordinate no update). Isso substitui este backfill por dados precisos.
-- ============================================================================
