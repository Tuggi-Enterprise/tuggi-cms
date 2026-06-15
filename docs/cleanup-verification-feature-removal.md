# Plano de remoção — feature legada de verificação/claims de descrições

**Status:** proposta (jun/2026). Nada executado.
**Motivo:** o subsistema de verificação de fatos (claims/scores/verification sources)
foi substituído pelo Google grounding. As tabelas pararam de receber dados entre
**ago/2025 e jan/2026** (confirmado por `max(created_at)` = 0 linhas nos últimos 90 dias).

⚠️ **Não é um DROP solto.** A *fonte de dados* morreu, mas o *código ainda lê* o cluster
em **dois caminhos vivos**. Por isso a remoção é faseada: destrinchar o vivo → remover o
morto → dropar. Cada fase deve ser deployada e verificada antes da próxima.

---

## Inventário do cluster

### Tabelas (com FKs — definem a ordem do drop)
| Tabela | rows | última linha | FK saindo | FK entrando |
|---|---|---|---|---|
| `core.description_claim_evidence` | 78 | 2025-08-17 | → description_claims | — |
| `core.description_claims` | 107 | 2025-09-18 | → description_scores, attraction_descriptions | ← description_claim_evidence |
| `core.description_scores` | 95 | 2026-01-09 | → attractions, attraction_descriptions | ← description_claims |
| `core.city_source_search_configs` | 23 | — | → city_verification_sources | — |
| `core.city_verification_sources` | 69 | 2025-09-16 | → countries | ← city_source_search_configs |
| `core.country_verification_sources` | 112 | 2025-09-08 | → countries | — |
| `core.import_batches` | 418 | 2025-09-08 | → users | ← **attractions** (`fk_attractions_import_batch`) |

### Triggers
- `trg_scores_mirror` em `description_scores` → fn `core.fn_update_description_score_mirror`
  (espelha score pra `attraction_descriptions.last_score_*` — colunas vestigiais)
- `update_verification_sources_updated_at` em `country_verification_sources` (drop junto)
- `handle_updated_at` em `import_batches` (drop junto)

### Funções do banco
**Mortas (só leem/escrevem o cluster) — dropar:**
- `core.save_description_verification_result` (escrevia claims/scores)
- `core.get_descriptions_for_batch_processing` (lia scores; usada só pelo verify-batch)
- `core.get_sources_for_country`, `core.get_verification_sources_layered`
- `core.fn_update_description_score_mirror`

**VIVAS (precisam ser EDITADAS p/ parar de ler o cluster):**
- `drive.calculate_poi_quality_score` — conta `description_claims` como input do score
- `drive.calculate_poi_score_simple` — idem
  - ⛔ Chamadas por `get_personalized_suggestions`, `get_companionship_aware_suggestions`,
    `get_personalized_suggestions_enhanced_v2` (motor de sugestões ATIVO).
- `core.cms_get_poi_stats` — usa `description_scores` só nos branches `score_filter`
  high/medium/low/no_score (SQL dinâmico)

### Código (CMS) — remover
- `supabase/functions/verify-batch/` (EF inteira)
- `lib/core/poi-verification-service.ts`
- `app/api/verify/status/route.ts` (e o resto de `app/api/verify/*`)
- `components/verification/VerificationDrawer.tsx` (+ onde é montado)
- `lib/services/dynamic-sources.ts` (uso de country_verification_sources)
- `lib/services/poi-import-service.ts` (uso de import_batches)
- `components/poi-management/POIDetailsModal.tsx` (~L877–898: `scoresData.description_claims`)
- `app/api/supabase/explore/route.ts` (tirar os nomes das tabelas da lista)

### Colunas vestigiais (em tabelas ATIVAS — limpeza opcional, fase 5)
- `attraction_descriptions.last_score_overall`, `last_score_version`, `last_verified_at`
- `attractions.import_batch_id` (a FK `fk_attractions_import_batch`)

### Cron
- Nenhum job referencia verify/verification (confirmado).

---

## Plano faseado

### Fase 0 — Confirmar
- [ ] Confirmar que a feature de verificação não será retomada (grounding é definitivo).
- [ ] Decidir se as colunas `last_score_*` / `import_batch_id` saem (fase 5) ou ficam.

### Fase 1 — Destrinchar o código VIVO (deploy + verificar antes de seguir)
1. **`drive.calculate_poi_quality_score` e `_simple`**: remover o bloco que conta
   `description_claims` (substituir o input por 0/constante ou retirar do cálculo).
   → Verificar que `get_personalized_suggestions*` continuam retornando sugestões.
2. **`core.cms_get_poi_stats`**: remover os branches `score_filter` = high/medium/low/no_score
   (description_scores). Manter os de approval (approved/pending/rejected).
3. **CMS lista de POIs**: tirar a opção de filtro por score (`'no_score'`) de
   `app/[locale]/pois/page.tsx` e `lib/core/poi-service.ts` (mantendo os filtros de approval).
   → Verificar que a lista e os contadores seguem funcionando.

### Fase 2 — Remover o código MORTO
4. Deletar EF `verify-batch`, `poi-verification-service.ts`, `app/api/verify/*`,
   `VerificationDrawer.tsx` (+ desmontagem), `dynamic-sources.ts`, uso de import_batches
   em `poi-import-service.ts`, trecho de claims no `POIDetailsModal.tsx`, nomes no
   `explore/route.ts`.
   → `npm run check-all` limpo; smoke test do POIDetailsModal e da lista.

### Fase 3 — DB: triggers + funções mortas (painel)
```sql
DROP TRIGGER IF EXISTS trg_scores_mirror ON core.description_scores;
DROP FUNCTION IF EXISTS core.fn_update_description_score_mirror();
DROP FUNCTION IF EXISTS core.save_description_verification_result(...);  -- conferir assinatura
DROP FUNCTION IF EXISTS core.get_descriptions_for_batch_processing(...);
DROP FUNCTION IF EXISTS core.get_sources_for_country(...);
DROP FUNCTION IF EXISTS core.get_verification_sources_layered(...);
```

### Fase 4 — DB: dropar tabelas na ordem das FKs (painel)
```sql
-- 1) remove a FK que a tabela ATIVA attractions tem pra import_batches
ALTER TABLE core.attractions DROP CONSTRAINT IF EXISTS fk_attractions_import_batch;

-- 2) tabelas (filhos primeiro)
DROP TABLE IF EXISTS core.description_claim_evidence;
DROP TABLE IF EXISTS core.description_claims;
DROP TABLE IF EXISTS core.description_scores;
DROP TABLE IF EXISTS core.city_source_search_configs;
DROP TABLE IF EXISTS core.city_verification_sources;
DROP TABLE IF EXISTS core.country_verification_sources;
DROP TABLE IF EXISTS core.import_batches;
```

### Fase 5 — Opcional: colunas vestigiais
```sql
ALTER TABLE core.attractions DROP COLUMN IF EXISTS import_batch_id;
ALTER TABLE core.attraction_descriptions
  DROP COLUMN IF EXISTS last_score_overall,
  DROP COLUMN IF EXISTS last_score_version,
  DROP COLUMN IF EXISTS last_verified_at;
```
⚠️ Conferir antes que nada lê `last_score_*` / `import_batch_id` (a remoção do código da
fase 1–2 deve ter eliminado os leitores).

---

## Riscos & verificação
- **Maior risco:** motor de sugestões da drive (fase 1.1). Testar `get_personalized_suggestions*`
  com um POI real antes e depois.
- **Ordem importa:** banco só depois do código (senão chamada quebra). Drop de tabela só
  depois das funções/triggers/FK que a citam.
- **Reversibilidade:** as tabelas têm pouco dado (≤418 linhas). Exportar um dump das 7 tabelas
  antes da fase 4 (`pg_dump`/CSV no painel) como backup.
- **Ganho:** não é de espaço (tabelas pequenas, ~1 MB total) — é de **clareza/manutenção**:
  remove uma feature inteira morta que ainda confunde o código e o schema.
