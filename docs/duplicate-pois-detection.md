# Sistema de Detecção de POIs Duplicados

Este sistema identifica POIs duplicados no banco de dados com base em critérios de nome, cidade e proximidade geográfica.

## 🎯 Objetivo

Verificar se há POIs com:
- **Mesmo nome** (normalizado, sem acentos e em minúsculas)
- **Mesma cidade**
- **Localização muito próxima** (menos de 100 metros)

**Estados analisados:** SP, RJ, MG

## 📁 Arquivos Criados

### Scripts SQL
- `scripts/check-duplicate-pois.sql` - Script SQL completo para análise manual
- `supabase/migrations/20241220000001_create_duplicate_pois_functions.sql` - Funções do banco de dados

### Scripts Node.js
- `scripts/duplicate-pois-checker.ts` - Script principal para execução e geração de relatórios
- `scripts/test-duplicate-check.ts` - Script de teste para validar funcionalidade

### Interface Web
- `app/duplicate-pois/page.tsx` - Interface web para visualizar e gerenciar duplicatas

## 🚀 Como Usar

### 1. Aplicar Migração do Banco de Dados

```bash
# Aplicar a migração no Supabase
supabase db push
```

### 2. Executar Verificação via Script

```bash
# Instalar dependências se necessário
npm install tsx

# Executar verificação completa
npx tsx scripts/duplicate-pois-checker.ts
```

### 3. Testar Funcionalidade

```bash
# Executar testes
npx tsx scripts/test-duplicate-check.ts
```

### 4. Usar Interface Web

1. Acesse: `http://localhost:3000/duplicate-pois`
2. Visualize estatísticas por estado
3. Filtre duplicatas por estado e nível de proximidade
4. Exporte relatórios em CSV

## 📊 Critérios de Detecção

### Normalização de Nomes
- Remove acentos (á → a, é → e, etc.)
- Converte para minúsculas
- Remove espaços extras
- Remove caracteres especiais

### Níveis de Proximidade
- **MUITO_PRÓXIMO**: < 10 metros
- **PRÓXIMO**: 10-50 metros  
- **RAZOAVELMENTE_PRÓXIMO**: 50-100 metros

### Sugestões de Ação
- **POSSÍVEL_DUPLICATA_EXATA**: < 10m e 2 POIs
- **POSSÍVEL_DUPLICATA**: < 50m e 2 POIs
- **MÚLTIPLAS_DUPLICATAS**: < 100m e > 2 POIs
- **REVISAR_MANUALMENTE**: Outros casos

## 🔧 Funções do Banco de Dados

### `calculate_distance_km(lat1, lon1, lat2, lon2)`
Calcula distância entre duas coordenadas usando fórmula de Haversine.

### `check_duplicate_pois()`
Retorna todos os grupos de POIs duplicados com distância < 100m.

### `get_duplicate_pois_stats()`
Retorna estatísticas resumidas por estado.

### `analyze_duplicate_group(input_poi_name, input_city_name, input_state_name)`
Análise detalhada de um grupo específico de duplicatas.

## 🌐 API Routes

### `/api/duplicate-pois`
Endpoint principal para acessar as funções de duplicatas.

**Métodos:**
- `GET /api/duplicate-pois` - Busca todas as duplicatas
- `GET /api/duplicate-pois?action=stats` - Busca estatísticas por estado
- `GET /api/duplicate-pois?action=analyze&poi_name=X&city_name=Y&state_name=Z` - Análise detalhada

**Respostas:**
```json
// Duplicatas
{ "duplicates": [...] }

// Estatísticas
{ "stats": [...] }

// Análise detalhada
{ "analysis": [...] }
```

## 📈 Relatórios Gerados

### JSON Report
- Localização: `reports/duplicate-pois-report-{timestamp}.json`
- Contém: dados completos, estatísticas, análises

### CSV Report  
- Localização: `reports/duplicate-pois-report-{timestamp}.csv`
- Formato: compatível com Excel/Google Sheets
- Contém: dados tabulares para análise

## 🎛️ Interface Web

### Visão Geral
- Estatísticas por estado (SP, RJ, MG)
- Resumo geral de duplicatas
- Contadores de POIs muito próximos

### Lista de Duplicatas
- Filtros por estado e proximidade
- Cards detalhados para cada grupo
- Informações de cada POI no grupo
- Status de aprovação e avaliações

### Funcionalidades
- **Atualizar**: Recarrega dados do banco
- **Exportar CSV**: Download de relatório
- **Filtros**: Por estado e nível de proximidade

## ⚠️ Considerações Importantes

### Performance
- Funções otimizadas com índices espaciais
- Consultas limitadas aos estados SP, RJ, MG
- Cálculos de distância em memória
- **Paginação automática** para contornar limite de 1000 registros do Supabase
- Processamento por estado para melhor distribuição de carga

### Precisão
- Fórmula de Haversine para distâncias geográficas
- Normalização de nomes para capturar variações
- Critério de 100m baseado em experiência prática

### Manutenção
- Funções SQL documentadas
- Scripts com tratamento de erros
- Logs detalhados para debugging

## 🔍 Exemplo de Uso

```sql
-- Verificar duplicatas manualmente
SELECT * FROM check_duplicate_pois() 
WHERE estado = 'SP' 
ORDER BY menor_distancia_metros ASC;

-- Analisar grupo específico
SELECT * FROM analyze_duplicate_group(
    'Museu do Ipiranga', 
    'São Paulo', 
    'SP'
);

-- Obter estatísticas
SELECT * FROM get_duplicate_pois_stats();
```

## 📝 Próximos Passos

1. **Revisar duplicatas encontradas** manualmente
2. **Decidir quais POIs manter** (baseado em critérios de qualidade)
3. **Remover ou mesclar** POIs duplicados
4. **Atualizar referências** em outras tabelas
5. **Implementar validação** para prevenir futuras duplicatas

## 🔧 Correções Aplicadas

### Problemas Resolvidos
- **Conflito de parâmetros**: Corrigido conflito de nomes na função `analyze_duplicate_group`
- **Referências incorretas**: Corrigido referências a colunas inexistentes nas CTEs
- **Componentes UI**: Substituído sistema de tabs por botões de toggle (compatível com projeto)
- **Import Supabase**: Corrigido para usar `useSupabaseClient` hook em vez de `createClient`
- **Schema restrictions**: Criado API route para contornar restrições de schema do Supabase

### Arquivos Atualizados
- `supabase/migrations/20241220000001_create_duplicate_pois_functions.sql`
- `app/duplicate-pois/page.tsx`
- `scripts/test-duplicate-check.ts`
- `app/api/duplicate-pois/route.ts` (novo)

## 🐛 Troubleshooting

### Erro: "Função não encontrada"
- Verifique se a migração foi aplicada
- Execute: `supabase db push`

### Erro: "Variáveis de ambiente"
- Configure `NEXT_PUBLIC_SUPABASE_URL`
- Configure `SUPABASE_SERVICE_ROLE_KEY`

### Erro: "Module not found: Can't resolve '@/components/ui/tabs'"
- ✅ **Resolvido**: Sistema de tabs substituído por botões de toggle

### Erro: "createClient is not exported"
- ✅ **Resolvido**: Usando `useSupabaseClient` hook

### Erro: "The schema must be one of the following: graphql_public, core, drive, walk"
- ✅ **Resolvido**: Criado API route que usa service role para contornar restrições de schema

### Problema: Limite de 1000 registros do Supabase
- ✅ **Resolvido**: Implementada paginação automática por estado
- **Como funciona**: Processa SP, RJ, MG separadamente em lotes de 1000
- **Benefício**: Garante análise completa de todos os POIs (17.000+)

### Performance lenta
- Verifique índices espaciais
- Considere limitar consultas por data
- Use filtros por estado

### Dados inconsistentes
- Verifique integridade das coordenadas
- Confirme normalização de nomes
- Valide critérios de proximidade
