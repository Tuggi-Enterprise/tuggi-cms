# Radar em tempo real: `visit_source` pendente na RPC

**Estado:** SQL escrito, **não executado**. O banco é DDL manual pelo painel, e a
função é do domínio do `data`.

## O que falta

`core.dashboard_recent_visited_pois` já devolve `visit_source`, e é dela que vem a
lista "POIs ouvidas agora" da Overview — o selo de engajamento (Trigger Point contra
play manual) aparece lá desde já.

`core.dashboard_realtime_activity`, que alimenta `/dashboard/realtime`, monta o
`jsonb` de `active_pois` sem a coluna. Enquanto ela não sair, `visitSourceKind()`
devolve `unknown` naquela tela e o cartão simplesmente omite o selo — nada é
afirmado errado, só falta informação.

## SQL a executar no painel

Só o `jsonb_build_object` e o `SELECT` interno mudam; o resto da função é o que já
está em produção. Rodar `CREATE OR REPLACE` com a definição atual mais estas duas
linhas:

```sql
-- em active_pois, dentro do jsonb_build_object:
'visit_source', sub2.visit_source,

-- em sub2, ao lado dos outros COALESCE:
COALESCE(pv.visit_source, 'unknown') as visit_source,
```

**Rollback:** `CREATE OR REPLACE` com a definição anterior (sem as duas linhas). A
função não guarda estado e nenhum dado é tocado; o CMS trata a ausência da chave.

## Por que não virou migration aqui

`supabase/migrations/` e todo SQL executado são do `data` (CLAUDE.md §1), e o
histórico de migrations do CMS não reflete este banco (memória
`project_db_repo_supabase_git_sync`).
