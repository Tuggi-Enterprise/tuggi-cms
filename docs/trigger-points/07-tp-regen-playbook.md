# Trigger Points — Regeneration Playbook

> Como regenerar TPs para POIs existentes no core, com suporte a múltiplos workers paralelos.

---

## Visão geral

O script `scripts/regen-trigger-points.ts` regenera TPs para POIs já migrados para `core.attractions`, usando o mesmo motor da página de teste (`/trigger-points-single`). Suporta:

- **POI único** — teste e debug
- **Batch com fila** — múltiplos workers paralelos sem coordenação manual (SKIP LOCKED)

---

## Pré-requisitos

### Migrações aplicadas no banco

```bash
# Verificar se as migrações estão aplicadas
supabase migration list
```

Migrações necessárias (aplicar no Supabase SQL Editor se não estiverem):
- `20260515_add_geofence_trigger_type.sql`
- `20260518_replace_trigger_points_atomic_rpc.sql`
- `20260518_tp_regen_queue.sql`

### Variáveis de ambiente

```bash
export $(grep -v '^#' .env | xargs)
```

Variáveis necessárias:
- `NEXT_PUBLIC_SUPABASE_URL` ou `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` ou `SUPABASE_SECRET_KEY`

---

## POI único (teste)

```bash
export $(grep -v '^#' .env | xargs) && \
npx tsx scripts/regen-trigger-points.ts --id <attraction_id>
```

---

## Batch completo (produção)

### Passo 1 — Criar a fila (1x por cidade/região)

```bash
export $(grep -v '^#' .env | xargs) && \
npx tsx scripts/regen-trigger-points.ts \
  --create-batch ny-2026-05-18 \
  --city "New York" \
  --state "New York" \
  --country "United States"
```

Cria `core.tp_regen_queue` com todos os POIs em status `pending`. O script pagina automaticamente para superar o limite de 2k linhas do Supabase.

### Passo 2 — Rodar workers em paralelo

Abra N terminais e rode o mesmo comando em cada um:

```bash
export $(grep -v '^#' .env | xargs) && \
npx tsx scripts/regen-trigger-points.ts --run-batch ny-2026-05-18
```

Cada worker usa `claim_next_regen()` (SKIP LOCKED) para pegar o próximo POI disponível sem conflito. O limite é a memória da máquina (~500-800MB por worker).

| RAM disponível | Workers recomendados | Tempo estimado (4267 POIs, ~15s/POI) |
|---|---|---|
| 8GB | 3 | ~6h |
| 16GB | 5 | ~3.5h |
| 32GB | 8 | ~2.2h |

### Passo 3 — Monitorar progresso

```bash
export $(grep -v '^#' .env | xargs) && \
npx tsx scripts/regen-trigger-points.ts --status ny-2026-05-18
```

Output:
```
📊 Batch "ny-2026-05-18":
  pending:    3100
  processing: 5
  done:       1162  (87432 TPs salvos)
  failed:     0
  total:      4267
```

### Recuperar após crash de worker

Se um worker morreu com itens em `processing`:

```bash
export $(grep -v '^#' .env | xargs) && \
npx tsx scripts/regen-trigger-points.ts --reset-stuck ny-2026-05-18
```

Recoloca os itens travados em `pending` para os outros workers continuarem.

---

## Arquitetura da fila

```
core.tp_regen_queue
  ├── batch_id      — identifica o batch (ex: "ny-2026-05-18")
  ├── attraction_id — FK para core.attractions
  ├── status        — pending | processing | done | failed
  ├── worker_id     — hostname-PID do worker que pegou o item
  ├── claimed_at    — quando foi claimado
  ├── completed_at  — quando terminou
  ├── tp_count      — quantos TPs foram salvos
  └── error_message — mensagem de erro (se failed)

core.claim_next_regen(batch_id, worker_id)
  — RPC atômica: SELECT ... FOR UPDATE SKIP LOCKED
  — Garante que cada POI é processado por exatamente 1 worker
```

---

## Flags disponíveis

| Flag | Descrição |
|---|---|
| `--id <uuid>` | Regenerar POI único |
| `--create-batch <nome>` | Criar fila para um batch |
| `--city / --state / --country` | Filtros para `--create-batch` |
| `--run-batch <nome>` | Iniciar worker que consome a fila |
| `--status <nome>` | Ver progresso do batch |
| `--reset-stuck <nome>` | Recolocar itens `processing` em `pending` |

---

## Notas importantes

- **Idempotente**: o motor usa `replace_all` atômico — re-rodar um POI substitui os TPs anteriores sem deixar o POI vazio.
- **Rodar novamente**: se precisar regerear uma cidade já processada, crie um novo batch com nome diferente (`ny-2026-06-01`) ou delete o antigo via SQL.
- **Mesmo motor**: usa `CoreTriggerPointPredictor` — resultado idêntico ao da página `/trigger-points-single`.
