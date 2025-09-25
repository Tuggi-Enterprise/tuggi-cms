# Scripts para Verificar Coordenadas Duplicadas

Este diretório contém scripts para verificar quais POIs têm mais de uma entrada na tabela `attraction_coordinate`.

## Scripts Disponíveis

### 1. `check-duplicate-coordinates-quick.ts` (Recomendado)
**Script mais simples e direto** - não requer funções SQL personalizadas.

```bash
npx tsx scripts/check-duplicate-coordinates-quick.ts
```

**Características:**
- ✅ Consulta direta ao banco de dados
- ✅ Não requer migrações SQL
- ✅ Mostra estatísticas básicas
- ✅ Calcula distâncias entre coordenadas
- ✅ Identifica coordenadas muito próximas (< 10m)

### 2. `check-duplicate-coordinates-simple.ts`
**Script com funções SQL otimizadas** - requer migração SQL.

```bash
npx tsx scripts/check-duplicate-coordinates-simple.ts
```

**Características:**
- ✅ Usa funções SQL otimizadas (se disponíveis)
- ✅ Fallback para consulta direta
- ✅ Estatísticas detalhadas
- ✅ Verificação de coordenadas próximas
- ⚠️ Requer migração SQL: `20241220000006_create_duplicate_coordinates_function.sql`

### 3. `check-duplicate-coordinates.ts`
**Script completo com análise avançada** - versão mais detalhada.

```bash
npx tsx scripts/check-duplicate-coordinates.ts
```

**Características:**
- ✅ Análise completa e detalhada
- ✅ Cálculo de distâncias precisas
- ✅ Exportação de dados
- ✅ Relatórios extensos
- ⚠️ Mais lento para grandes volumes de dados

## Como Usar

### Pré-requisitos
1. Certifique-se de que as variáveis de ambiente estão configuradas:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   ```

2. Instale as dependências:
   ```bash
   npm install
   ```

### Execução Rápida (Recomendada)
```bash
# Script mais simples e rápido
npx tsx scripts/check-duplicate-coordinates-quick.ts
```

### Execução com Funções SQL Otimizadas
1. Primeiro, aplique a migração SQL:
   ```bash
   # No Supabase Dashboard ou via CLI
   # Execute o arquivo: supabase/migrations/20241220000006_create_duplicate_coordinates_function.sql
   ```

2. Execute o script:
   ```bash
   npx tsx scripts/check-duplicate-coordinates-simple.ts
   ```

## Saída dos Scripts

Os scripts exibem:

### 📊 Estatísticas
- Total de POIs com múltiplas coordenadas
- Total de coordenadas duplicadas
- Média de coordenadas por POI duplicado
- Máximo de coordenadas por POI

### 📍 Detalhes dos POIs
Para cada POI com múltiplas coordenadas:
- Nome do POI
- Localização (cidade, país)
- ID do POI
- Número total de coordenadas
- Lista de todas as coordenadas com:
  - Latitude e longitude
  - ID da coordenada
  - Data de criação
- Distância aproximada entre coordenadas

### ⚠️ Coordenadas Muito Próximas
- Lista de POIs com coordenadas muito próximas (< 10 metros)
- Possíveis duplicatas reais que precisam de limpeza

## Exemplo de Saída

```
🔍 Verificação rápida de POIs com múltiplas coordenadas...

📊 Total de POIs com múltiplas coordenadas: 3

📍 POIs com múltiplas coordenadas:

1. Museu do Ipiranga
   📍 Localização: São Paulo, Brasil
   🆔 ID: 123e4567-e89b-12d3-a456-426614174000
   📊 Total de coordenadas: 2
   📍 Coordenadas:
      1. Lat: -23.5855, Lng: -46.6094
         🆔 Coord ID: coord-123
         📅 Criado em: 20/12/2024 10:30:00
      2. Lat: -23.5856, Lng: -46.6095
         🆔 Coord ID: coord-124
         📅 Criado em: 20/12/2024 11:15:00
   📏 Distância aproximada entre coordenadas: 12.34 metros

📊 Estatísticas:
   Total de POIs com duplicatas: 3
   Total de coordenadas duplicadas: 7
   Média de coordenadas por POI duplicado: 2.33

⚠️  1 POIs com coordenadas muito próximas (< 10m):
   - Museu do Ipiranga (São Paulo)

✅ Verificação concluída!
```

## Troubleshooting

### Erro: "Função RPC não encontrada"
- Use o script `check-duplicate-coordinates-quick.ts` que não requer funções SQL
- Ou aplique a migração SQL primeiro

### Erro: "Schema must be one of the following"
- Verifique se está usando o schema correto (`core`)
- Certifique-se de que as variáveis de ambiente estão corretas

### Erro: "Permission denied"
- Verifique se a `SUPABASE_SERVICE_ROLE_KEY` tem permissões adequadas
- Use a chave de serviço, não a chave anônima

## Limpeza de Dados

Após identificar POIs com coordenadas duplicadas, você pode:

1. **Manter a coordenada mais recente** (baseada em `created_at`)
2. **Manter a coordenada mais precisa** (baseada em critérios de qualidade)
3. **Remover coordenadas muito próximas** (distância < 10m)
4. **Investigar manualmente** casos específicos

## Notas Técnicas

- Os scripts usam a fórmula de Haversine para calcular distâncias
- A precisão da distância é adequada para coordenadas geográficas
- Os scripts são otimizados para performance com grandes volumes de dados
- Todas as consultas respeitam as permissões do banco de dados
