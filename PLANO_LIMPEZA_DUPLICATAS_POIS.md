# Plano de Limpeza: Duplicatas na Tabela homolog.pois

## Objetivo

Investigar e limpar POIs duplicados na tabela `homolog.pois` seguindo as regras:
- **N POIs com mesmo nome na mesma cidade** = Deixar 1, apagar demais
- **N POIs com mesmo nome em cidades diferentes** = Não apagar nada

## Regras de Negócio

1. **Duplicatas na mesma cidade**: Quando há múltiplos POIs com o mesmo nome na mesma cidade, manter apenas 1 (o mais antigo) e apagar os demais.

2. **Mesmo nome, cidades diferentes**: POIs com o mesmo nome mas em cidades diferentes NÃO são considerados duplicatas e NÃO devem ser apagados.

3. **Critério de seleção**: Entre os duplicados, manter o POI mais antigo (baseado em `created_at`). Em caso de empate, usar `uuid_id` como critério de desempate.

4. **Dependências**: Antes de apagar POIs, verificar e remover coordenadas relacionadas na tabela `homolog.coordinates`.

## Ferramentas de Investigação

### 1. Script SQL de Investigação

**Arquivo**: `scripts/investigate-duplicates-same-city.sql`

Execute no Supabase SQL Editor para obter:
- Estatísticas gerais da tabela
- Identificação de grupos de duplicatas
- Detalhamento dos POIs que serão mantidos vs apagados
- Verificação de dependências (coordenadas)

**Uso**:
```sql
-- Copiar e colar o conteúdo do arquivo no Supabase SQL Editor
```

### 2. Script TypeScript de Investigação

**Arquivo**: `scripts/investigate-duplicates-same-city.ts`

Gera um relatório JSON detalhado com:
- Estatísticas completas
- Lista de todos os grupos de duplicatas
- Detalhes de cada POI (mantido/apagado)
- Informações sobre coordenadas relacionadas

**Uso**:
```bash
npm run investigate:duplicates
# ou
npx tsx scripts/investigate-duplicates-same-city.ts
```

**Saída**: Arquivo JSON `duplicates-investigation-{timestamp}.json`

## Processo de Limpeza

### Fase 1: Investigação ✅

1. **Executar script SQL de investigação**
   - Revisar estatísticas gerais
   - Identificar grupos de duplicatas
   - Verificar dependências

2. **Executar script TypeScript de investigação**
   - Gerar relatório JSON detalhado
   - Revisar top 20 grupos de duplicatas
   - Validar números antes de prosseguir

3. **Análise manual (opcional)**
   - Revisar exemplos específicos de duplicatas
   - Verificar se há casos especiais que precisam de atenção
   - Confirmar que as regras estão sendo aplicadas corretamente

### Fase 2: Preparação

1. **Backup da tabela** (recomendado)
   ```sql
   -- Criar backup da tabela antes da limpeza
   CREATE TABLE homolog.pois_backup_YYYYMMDD AS 
   SELECT * FROM homolog.pois;
   ```

2. **Verificar integridade referencial**
   - Confirmar que não há outras tabelas dependentes
   - Verificar constraints e foreign keys

### Fase 3: Limpeza (A SER CRIADO)

**⚠️ ATENÇÃO**: O script de limpeza ainda não foi criado. Será criado após revisão dos resultados da investigação.

O script de limpeza deve:
1. Identificar POIs duplicados (mesmo nome + mesma cidade)
2. Manter o POI mais antigo de cada grupo
3. Apagar coordenadas relacionadas aos POIs que serão removidos
4. Apagar os POIs duplicados
5. Gerar relatório de execução

**Estrutura planejada**:
- Script SQL: `scripts/cleanup-duplicates-same-city.sql`
- Script TypeScript: `scripts/cleanup-duplicates-same-city.ts` (com modo dry-run)

## Estrutura dos Scripts

### Script SQL (`investigate-duplicates-same-city.sql`)

Contém queries para:
1. Estatísticas gerais
2. Identificação de duplicatas
3. Detalhamento de grupos
4. Verificação de dependências
5. Resumo final

### Script TypeScript (`investigate-duplicates-same-city.ts`)

Funcionalidades:
- Conexão com Supabase usando padrão do projeto
- Análise completa dos dados
- Geração de relatório JSON
- Exibição de estatísticas no console
- Identificação de POIs a manter/apagar

## Exemplo de Saída Esperada

```
🔍 Iniciando investigação de duplicatas em homolog.pois...

1️⃣ Coletando estatísticas gerais...
   ✅ Total de POIs: 50,000
   ⚠️  POIs com nome NULL: 100
   ⚠️  POIs com cidade NULL: 50

2️⃣ Identificando grupos de duplicatas (nome + cidade)...
   ✅ POIs analisados: 49,850
   ✅ Grupos de duplicatas encontrados: 150
   ✅ Total de POIs duplicados: 350
   ✅ POIs que serão MANTIDOS: 150
   ✅ POIs que serão APAGADOS: 200

3️⃣ Verificando POIs com mesmo nome em cidades diferentes...
   ✅ Nomes que aparecem em múltiplas cidades: 500
   ℹ️  Estes POIs NÃO serão apagados (regra: cidades diferentes)

4️⃣ Verificando dependências (coordenadas relacionadas)...
   ⚠️  Coordenadas relacionadas a POIs que serão apagados: 180
   ℹ️  Estas coordenadas também precisarão ser removidas

5️⃣ Top 20 grupos de duplicatas:
   [detalhes dos grupos...]

6️⃣ Gerando relatório detalhado...
   ✅ Relatório salvo em: duplicates-investigation-1234567890.json
```

## Próximos Passos

1. ✅ Criar scripts de investigação (SQL e TypeScript)
2. ⏳ Executar investigação e revisar resultados
3. ⏳ Criar script de limpeza baseado nos resultados
4. ⏳ Testar script de limpeza em modo dry-run
5. ⏳ Executar limpeza após aprovação
6. ⏳ Validar resultados pós-limpeza

## Notas Importantes

- **Backup**: Sempre fazer backup antes de executar limpeza
- **Dry-run**: Testar primeiro em modo dry-run
- **Validação**: Revisar cuidadosamente os resultados da investigação
- **Dependências**: Verificar e tratar coordenadas relacionadas
- **Auditoria**: Manter log de todas as operações realizadas

## Referências

- Scripts existentes que conectam com `homolog.pois`:
  - `scripts/analyze-duplicates.ts`
  - `scripts/test-create-poi-rpc.ts`
  - `scripts/city-correction-simple.ts`
  - `lib/hooks/use-homolog-poi-viewer.ts`

