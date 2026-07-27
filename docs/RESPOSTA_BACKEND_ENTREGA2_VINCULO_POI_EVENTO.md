# Resposta backend — Entrega 2: desenho do vínculo POI ↔ Evento

Resposta ao pedido em [PEDIDO_BACKEND_EVENTOS.md](./PEDIDO_BACKEND_EVENTOS.md), Entrega 2. Escopo desta entrega: **só desenho** — modelagem no banco, mudança na RPC, UI no CMS e plano de amarração do acervo. Nada aplicado. Migrations aqui são para rodar **manualmente no painel (SQL Editor)**, nunca por CLI.

Verificação do estado atual (feita antes deste desenho):

| Afirmação do pedido | Confere? | Onde |
|---|---|---|
| `event_details` não aponta para POI anfitrião (25 col.) | ✅ | [20260703_02_event_details.sql](../supabase/migrations/20260703_02_event_details.sql) |
| `app_get_nearby_events` já projeta `trigger_points` | ✅ | [20260708_01_events_narration_payload.sql:45](../supabase/migrations/20260708_01_events_narration_payload.sql#L45) |
| `generate-description` lê `attraction_group_members` (`group_role='main'`) | ✅ | [generate-description/index.ts:278](../supabase/functions/generate-description/index.ts#L278) |
| Drawer reusa `TriggerPointsTab` p/ os 3 tipos | ✅ | [EntityManagementDrawer.tsx:123](../components/entity-management/EntityManagementDrawer.tsx#L123) |
| Gatilho de invalidação simétrico já existe p/ mudança de texto | ✅ | [20260715_02_invalidate_audio_on_description_change.sql](../supabase/migrations/20260715_02_invalidate_audio_on_description_change.sql) |

---

## (a) Modelagem — decisão: **coluna nova `event_details.venue_attraction_id`**

Descartado reusar `attraction_group_members`. O reuso *parece* de graça (a `generate-description` já lê membros de grupo), mas:

- **O "grátis" é raso.** A EF puxa membros como `name, category, type` — não sabe que é evento nem lê datas. O cenário 1 (POI narra o evento como adendo datado, tempo verbal ancorado em `todayStr`) exige query especializada de qualquer forma. O atalho não poupa a Entrega 3.
- **Overload semântico.** `group_role='member'` hoje = "sub-POI dentro de um POI-pai", e alimenta os filtros de `cms_list_pois` ("tem grupo / é main / é member"). Evento como membro faria o filtro "member" devolver eventos misturados com sub-POIs, e misturaria sub-POI + evento sob o mesmo pai.
- **A coluna é o modelo honesto.** 1 evento → 1 POI anfitrião, N eventos por POI (cardinalidade natural). A data continua em `event_details.starts_at/ends_at`. As regras (b) e o gatilho da Entrega 3 viram `WHERE venue_attraction_id IS NOT NULL`.

### Migration proposta

```sql
-- ============================================================================
-- 20260728_01_event_venue_link.sql
-- Vínculo Evento → POI anfitrião. APLICAR MANUAL NO PAINEL (SQL Editor).
-- ============================================================================

ALTER TABLE core.event_details
  ADD COLUMN IF NOT EXISTS venue_attraction_id UUID
    REFERENCES core.attractions(id) ON DELETE SET NULL;

COMMENT ON COLUMN core.event_details.venue_attraction_id IS
  'POI anfitrião onde o evento acontece (entity_kind=''poi''). NULL = evento autônomo '
  '(mantém TP/narração próprios). Quando preenchido: o POI narra o evento e o app '
  'NÃO recebe trigger_points deste evento (ver app_get_nearby_events).';

-- Um evento não pode ser sede de si mesmo.
ALTER TABLE core.event_details
  DROP CONSTRAINT IF EXISTS event_venue_not_self;
ALTER TABLE core.event_details
  ADD CONSTRAINT event_venue_not_self
  CHECK (venue_attraction_id IS NULL OR venue_attraction_id <> attraction_id);

-- Índice parcial: a maioria (eventos autônomos) fica NULL. Serve a RPC de nearby,
-- o gatilho de invalidação (Entrega 3) e o "eventos neste POI" no CMS.
CREATE INDEX IF NOT EXISTS idx_event_details_venue
  ON core.event_details (venue_attraction_id)
  WHERE venue_attraction_id IS NOT NULL;

-- Guarda de tipo: o anfitrião TEM que ser um POI (é ele que o app enxerga/narra).
-- FK não consegue restringir por entity_kind; trigger faz.
CREATE OR REPLACE FUNCTION core.tg_event_venue_must_be_poi()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.venue_attraction_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM core.attractions a
      WHERE a.id = NEW.venue_attraction_id AND a.entity_kind = 'poi'
    ) THEN
      RAISE EXCEPTION 'venue_attraction_id % não é um POI (entity_kind=poi)', NEW.venue_attraction_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_venue_must_be_poi ON core.event_details;
CREATE TRIGGER event_venue_must_be_poi
  BEFORE INSERT OR UPDATE OF venue_attraction_id ON core.event_details
  FOR EACH ROW EXECUTE FUNCTION core.tg_event_venue_must_be_poi();
```

Decisões embutidas e por quê:

- **`ON DELETE SET NULL`** (não CASCADE): apagar o POI anfitrião não apaga o evento — ele volta a ser autônomo e reassume TP/narração próprios.
- **Anfitrião só pode ser `entity_kind='poi'`** (não event/place): é o único que o app enxerga e narra hoje. `place` fica como extensão futura, se places passarem a ser consumidos.
- **Índice parcial** em vez de cheio: eventos autônomos dominam o acervo e não precisam entrar no índice.

---

## (b) Regra "evento vinculado não tem TP" — no banco, em `app_get_nearby_events`

A RPC já projeta `trigger_points`. A supressão não muda a assinatura (`RETURNS TABLE`), então é **`CREATE OR REPLACE`** — sem DROP. Uma única linha na projeção:

```sql
-- dentro do SELECT de core.app_get_nearby_events, trocar:
--   COALESCE(tp.trigger_points, '[]'::jsonb) AS trigger_points
-- por:
    CASE
      WHEN ed.venue_attraction_id IS NOT NULL THEN '[]'::jsonb   -- vinculado: quem narra é o POI
      ELSE COALESCE(tp.trigger_points, '[]'::jsonb)
    END AS trigger_points,
```

Efeito: para todo evento com anfitrião, o app recebe `trigger_points = []` e nunca dispara narração pelo evento — o TP do POI cobre. O app **não aprende** o conceito de vínculo; a regra mora num lugar só.

Notas e um ponto que precisa de decisão de produto:

- **Só `trigger_points` é suprimido**, conforme o pedido. `audio_descriptions` fica (é inofensivo sem TP para disparar, e uma tela "eventos por perto" ainda pode mostrar o texto/áudio sob demanda).
- **Decisão em aberto:** o evento vinculado deve **continuar aparecendo** na lista de `app_get_nearby_events` (só mudo), ou sair dela por completo (só existe através do POI)? O pedido pede apenas suprimir TP → mantenho na lista. Se a UX de "eventos por perto" não deve listar o que já está dentro de um POI, é um `AND ed.venue_attraction_id IS NULL` no `WHERE` — trivial, mas é escolha de produto.
- **Autoria dupla no CMS** (item c) é o cinto+suspensório: a RPC é a verdade; a UI evita a confusão de alguém autorar TP num evento vinculado.

---

## (c) UI no CMS

Dois pontos, ambos em componentes que já existem.

### 1. Picker de POI anfitrião — aba *Details* do evento

[EventFormModal.tsx](../components/event-management/EventFormModal.tsx) monta os campos de `event_details`. Adicionar um campo **"POI anfitrião (opcional)"** — autocomplete de POI reusando a busca de POIs já existente (`cms_list_pois`/busca), que grava `form.venue_attraction_id`. Quando preenchido, mostra `nome do POI + botão limpar`. O `eventService.create/update` passa a persistir `venue_attraction_id`.

- **Coordenada do evento:** continua obrigatória no create (a RPC posiciona por `attraction_coordinate`). Oferecer um atalho "usar a coordenada do anfitrião" é UX opcional; não é requisito.
- **Restringir o autocomplete a `entity_kind='poi'`** (a busca de POI já filtra isso), casando com a guarda de tipo do banco.

### 2. Gate na aba de Trigger Points

[EntityManagementDrawer.tsx:122-123](../components/entity-management/EntityManagementDrawer.tsx#L122) renderiza `<TriggerPointsTab/>` para os 3 tipos. Quando o evento tem `venue_attraction_id`:

- substituir o conteúdo da aba "Boundary & Triggers" por um **banner explicativo** — *"Este evento é narrado pelo POI anfitrião **{nome}**. Trigger points não se aplicam: o app usa o TP do anfitrião."*
- o drawer precisa receber isso via contexto/props (`venueLinked: boolean` + `venueName?: string`), montado no `useEntityModalContext`.

Não precisa bloquear a navegação da aba — só trocar o conteúdo. Isso impede a autoria de TP conflitante na origem, além da supressão na RPC.

---

## (d) Amarração do acervo (442 eventos)

Não dá para auto-linkar: a coordenada do evento costuma ser a praça/rua, não o POI anfitrião (o pedido já observa). Além disso o nome do evento raramente contém o nome do anfitrião ("Festa da Padroeira" não diz "Igreja X"), então casamento por nome é sinal fraco. É **curadoria assistida**, não automação.

### Diagnóstico proposto (read-only, sugere candidatos)

```sql
-- Para cada evento com anfitrião provável, lista os POIs mais próximos p/ o curador escolher.
-- Rodar no painel; exportar; confirmar 1 a 1 no CMS. NÃO grava nada.
SELECT
  e.id                            AS event_id,
  ea.name                         AS event_name,
  ed.starts_at,
  p.id                            AS candidate_poi_id,
  pa.name                         AS candidate_poi_name,
  pa.category                     AS candidate_category,
  round(ST_Distance(ec.location_geography, pc.location_geography)::numeric, 1) AS dist_m,
  EXISTS (SELECT 1 FROM core.attraction_trigger_points t
          WHERE t.attraction_id = p.id AND t.is_active) AS poi_has_tp
FROM core.attractions ea
JOIN core.event_details ed        ON ed.attraction_id = ea.id AND ed.venue_attraction_id IS NULL
JOIN core.attraction_coordinate ec ON ec.attraction_id = ea.id
JOIN LATERAL (
  SELECT a.id, ac.location_geography
  FROM core.attractions a
  JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
  WHERE a.entity_kind = 'poi' AND a.is_active
    AND ST_DWithin(ac.location_geography, ec.location_geography, 200)  -- 200 m
  ORDER BY ac.location_geography <-> ec.location_geography
  LIMIT 3
) p ON true
JOIN core.attractions pa          ON pa.id = p.id
JOIN core.attraction_coordinate pc ON pc.attraction_id = p.id
WHERE ea.entity_kind = 'event' AND ea.approved
ORDER BY ea.name, dist_m;
```

Fluxo: exportar → curador confirma no CMS (o picker de (c)) → `venue_attraction_id` gravado.

**Dois avisos que o backfill precisa carregar:**

1. **O anfitrião precisa TER TP/boundary ativo**, senão o evento vinculado fica **mudo** (a coluna `poi_has_tp` no diagnóstico já sinaliza). Onde o POI não tem TP, ou se autora um, ou não se vincula.
2. **Eventos que já têm TP próprio autorado**: ao vincular, o TP do evento vira dado morto (a RPC o suprime, mas ele reaparece se o vínculo for desfeito). Decidir se desativa/apaga o TP do evento no momento do vínculo.

---

## Ganchos que a Entrega 3 vai usar (fora deste escopo, mas o desenho não pode travar)

Este desenho já deixa a Entrega 3 viável — só registrando para não pintar num canto:

- **Gatilho de invalidação simétrico.** Quando um evento é vinculado/aprovado num POI, a descrição enriquecida do POI precisa ser invalidada p/ regerar mencionando o evento — espelho do que a [20260715_02](../supabase/migrations/20260715_02_invalidate_audio_on_description_change.sql) faz para mudança de texto. O índice parcial em `venue_attraction_id` torna esse gatilho barato. (A regra "expira degradando p/ a descrição base, nunca silêncio" e a coluna `valid_until` são Entrega 3.)
- **N eventos simultâneos por POI.** A cardinalidade N:1 permite o POI hospedar vários eventos ao mesmo tempo; a narração do POI (Entrega 3) precisa listar/priorizar os que estão vigentes.
- **`app_get_pois_by_cone` não projeta `boundary_geojson/category/boundary_area_m2/business_status`** (o `nearby` projeta). Migration pequena, fora da Entrega 2, mas vira relevante p/ detecção por boundary no modo navegação — que é como o cenário 1 dispara em rota.

## Decisões finais (27/jul) — e o que foi implementado

O usuário fechou as três questões e **encolheu o escopo**: eventos hoje só são *mostrados* no app (não narrados), então por ora criamos **só a possibilidade de vínculo no CMS** (vínculos manuais). Nada de backfill automático, nada de tocar no app.

1. **Evento vinculado continua na lista** de `app_get_nearby_events` — listagem e vínculo são coisas separadas. → **não tocamos na RPC do app.**
2. **Ao vincular, os TPs próprios do evento são desativados** *e* o CMS **não oferece criação de TP** para evento vinculado.
3. **POI sem TP: backend não faz nada** — curadoria ajeita manual.

**Consequência elegante:** como o `app_get_nearby_events` já agrega só TPs `is_active=true`, desativar os TPs do evento no momento do vínculo faz a supressão acontecer **naturalmente** — a alteração da RPC proposta em (b) fica **desnecessária agora** (menor risco na RPC ao vivo). Fica registrada para quando o app passar a narrar eventos, se algum dia um vínculo precisar coexistir com TP ativo.

### Implementado

- **Migration** [20260727_01_event_venue_link.sql](../supabase/migrations/20260727_01_event_venue_link.sql) — **⏳ aplicar manual no painel**: coluna `venue_attraction_id` (+ CHECK not-self + índice parcial), trigger `event_venue_must_be_poi` (guarda de tipo), trigger `event_venue_deactivate_tps` (desativa TPs ao vincular), e `get_event_details` mesclando `venue_name` no jsonb (`to_jsonb(ed.*) || jsonb_build_object('venue_name', va.name)`).
- **Front** — `components/entity-management/VenuePicker.tsx` (autocomplete de POI reusando `poiService.search`), seção "Anfitrião" no [EventFormModal.tsx](../components/event-management/EventFormModal.tsx) (edição), e gate no [EntityManagementDrawer.tsx](../components/entity-management/EntityManagementDrawer.tsx) (aba de TP vira painel explicativo quando vinculado). i18n nos 3 locales. Type-check limpo.

### Fora do escopo (registrado p/ depois)
Backfill/diagnóstico do acervo, narração do POI mencionando o evento (Entrega 3: `valid_until`), e a projeção faltante do `app_get_pois_by_cone`.
