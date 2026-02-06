# Gerenciamento de POIs Duplicados

Este conjunto de scripts serve para identificar e remover POIs duplicados no
ecossistema do Tuggi CMS, cobrindo tanto duplicatas internas na tabela de
homologação quanto duplicatas já migradas para a tabela core.

## 1. Duplicatas entre Homolog e Core (Scripts Oficiais)

Estes scripts são usados para limpar a tabela `homolog.pois` removendo registros
que já foram migrados com sucesso para a tabela `core.attractions`.

### Analisar Duplicatas Migradas

Identifica quais UUIDs na tabela `homolog.pois` já existem em
`core.attractions`.

```bash
npm run analyze:migrated
```

_Gera o arquivo `migrated_duplicates.json` com a lista de IDs encontrados._

### Limpar Duplicatas Migradas

Remove os registros identificados pela análise anterior da tabela
`homolog.pois`.

```bash
npm run cleanup:migrated
```

_Lê o arquivo `migrated_duplicates.json` para realizar a deleção._

---

## 2. Duplicatas Internas (Mesma Tabela)

Estes scripts lidam com POIs que estão duplicados dentro da própria tabela
`homolog.pois` (ex: mesmo nome na mesma cidade, mas com UUIDs diferentes).

### Investigar Duplicatas

Analisa POIs com mesmo nome na mesma cidade dentro do homolog.

```bash
npm run investigate:duplicates
```

### Limpar Duplicatas Internas

Remove duplicatas internas mantendo apenas o registro mais antigo de cada grupo.

```bash
npm run cleanup:duplicates
```

---

## Observações Importantes

1. **Variáveis de Ambiente**: Certifique-se de que o `.env` ou `.env.local`
   contenha as chaves do Supabase (`SUPABASE_URL` e
   `SUPABASE_SERVICE_ROLE_KEY`).
2. **Segurança**: Antes de qualquer limpeza em massa, é recomendável rodar
   primeiro o script de análise/investigação para revisar o volume de dados que
   será afetado.
3. **Backup**: O arquivo `migrated_duplicates.json` é mantido após a limpeza
   como forma de log de segurança.
