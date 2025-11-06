# Script de Reparação de Categorias Unknown

## Descrição

Script provisório para reparar POIs na tabela `homolog.pois` que estão com `category = 'unknown'`.

O script:
1. Busca POIs com `category = 'unknown'` na tabela `homolog.pois`
2. Para cada POI, consulta o OSM/Nominatim:
   - **Se tiver `osm_id` e `osm_type`**: Usa lookup direto por OSM ID (mais rápido e preciso)
   - **Se não tiver OSM ID**: Usa busca por nome + coordenadas
3. Extrai dados de categoria do resultado do Nominatim
4. Atualiza os seguintes campos de categoria:
   - `category`
   - `primary_category`
   - `primary_category_type`
   - `categories` (JSONB array)

## Como Usar

### Pré-requisitos

1. Certifique-se de que as variáveis de ambiente estão configuradas:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

2. Instale as dependências:
```bash
npm install
```

### Executar o Script

```bash
npx tsx scripts/fix-unknown-categories.ts
```

Ou:

```bash
ts-node scripts/fix-unknown-categories.ts
```

### Funcionamento

- O script processa um POI por vez
- Respeita rate limits do Nominatim (1 segundo entre requisições)
- Valida similaridade de nomes e distância geográfica antes de atualizar
- Mostra estatísticas em tempo real
- Pode ser interrompido com `Ctrl+C` a qualquer momento

### Estratégias de Busca

1. **Lookup por OSM ID** (prioridade): Se o POI tiver `osm_id` e `osm_type`, usa a API de lookup do Nominatim diretamente - muito mais rápido e preciso
2. **Busca por nome + localização**: Se não tiver OSM ID, tenta encontrar o POI usando nome, cidade, estado e país
3. **Reverse geocoding**: Se a busca por nome falhar, tenta usar as coordenadas para encontrar o POI

### Extração de Categorias

O script extrai todos os campos de categoria seguindo esta prioridade:

1. **Tags específicas** de `extratags` (tourism, amenity, historic, natural, leisure, etc.)
   - Extrai o valor da tag como `category` e `primary_category`
   - Usa o nome da tag como `primary_category_type` (ex: "tourism", "amenity")
   - Cria array `categories` com formato "type=value" (ex: ["tourism=museum"])

2. **Class/Type** do resultado do Nominatim (fallback)
   - Usa `type` como categoria se não for genérico
   - Usa `class` como tipo

3. **Múltiplas categorias**: Se encontrar múltiplas tags relevantes, todas são incluídas no array `categories`

### Validações

- Verifica distância geográfica (POIs muito distantes são ignorados)
- Verifica similaridade de nomes (pelo menos 50% das palavras significativas devem aparecer)
- Apenas atualiza se encontrar uma categoria válida (não "unknown")

### Estatísticas

O script mostra:
- Total de POIs com `category = 'unknown'`
- POIs processados
- Categorias atualizadas com sucesso
- POIs não encontrados no OSM/Nominatim
- Erros encontrados

## Notas Importantes

⚠️ **Este é um script provisório** criado para reparar POIs importados que ficaram com categoria "unknown".

⚠️ O script atualiza **apenas os campos de categoria** (`category`, `primary_category`, `primary_category_type`, `categories`) - não altera nenhum outro campo do POI.

⚠️ O script respeita rate limits do Nominatim, então pode levar algum tempo para processar muitos POIs.

## Exemplo de Saída

```
🔧 Script de Reparação de Categorias Unknown
==========================================
📋 Busca POIs com category="unknown" e tenta atualizar via OSM/Nominatim
⏹️  Pressione Ctrl+C para parar

📊 Total de POIs com category="unknown": 150

[1/150] Processando: Museu do Ipiranga
📍 Coordenadas: -23.5850, -46.6094
🏙️  Localização: São Paulo, SP, Brazil
🔖 OSM ID: W12345678
🔍 Buscando por OSM ID: W12345678
✅ Categorias encontradas via OSM ID: "museum" (tourism)
✅ Categorias atualizadas:
   - category: "museum"
   - primary_category: "museum"
   - primary_category_type: "tourism"
   - categories: ["tourism=museum"]

[2/150] Processando: Parque Ibirapuera
...
```

