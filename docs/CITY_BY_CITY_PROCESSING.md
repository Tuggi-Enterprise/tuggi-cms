# Processamento Cidade por Cidade - Guia Completo

## 📋 Visão Geral

Este documento explica como **executar a Fase 1 primeiro** (filtrar por categorias), **listar cidades do arquivo filtrado**, e então **analisar POIs cidade por cidade** para garantir maior assertividade na filtragem de POIs turísticos.

## 🎯 Fluxo Recomendado

### Abordagem: Fase 1 → Listar Cidades → Analisar POI a POI

1. **Executar Fase 1 primeiro**: Filtrar por categorias básicas (tourism, historic, natural, leisure, etc.) para eliminar muita coisa
2. **Listar cidades do arquivo filtrado**: Ver quais cidades têm POIs nas categorias da Fase 1
3. **Escolher uma cidade**: Selecionar uma cidade para análise detalhada
4. **Analisar POI a POI**: Extrair POIs da cidade e analisar um por um para entender se está dentro do que necessitamos

### Por que Este Fluxo?

1. **Reduz volume primeiro**: Fase 1 elimina ~90% dos dados, deixando apenas categorias relevantes
2. **Trabalho em arquivo menor**: Mais fácil trabalhar com arquivo já filtrado
3. **Análise granular**: Analisar POI a POI permite identificar o que é realmente turístico
4. **Maior assertividade**: Entender quais POIs são válidos e quais devem ser removidos

## 🚀 Fluxo Completo: Fase 1 → Listar Cidades → Analisar POIs

### Passo 1: Executar Fase 1 (Filtrar por Categorias)

```bash
# Executar Fase 1 e listar cidades automaticamente
~/.deno/bin/deno run --allow-read --allow-write --allow-run --allow-net \
  scripts/analyze-city-pois.ts omsData/sudeste-251012.osm.pbf \
  --list-only
```

Isso irá:
1. Executar Fase 1 (filtrar por categorias da Fase 1)
2. Listar todas as cidades que têm POIs no arquivo filtrado

### Passo 2: Analisar POIs de uma Cidade Específica

```bash
# Analisar POIs de uma cidade
~/.deno/bin/deno run --allow-read --allow-write --allow-run --allow-net \
  scripts/analyze-city-pois.ts omsData/sudeste-251012.osm.pbf \
  --city "Bragança Paulista"
```

Isso irá:
1. Executar Fase 1 (se ainda não foi executada)
2. Extrair POIs da cidade do arquivo filtrado da Fase 1
3. Gerar GeoJSON e CSV para análise POI a POI

### Passo 3: Usar Arquivo da Fase 1 Já Existente

Se você já executou a Fase 1 antes, pode usar o arquivo existente:

```bash
# Listar cidades do arquivo da Fase 1 já existente
~/.deno/bin/deno run --allow-read --allow-write --allow-run --allow-net \
  scripts/analyze-city-pois.ts omsData/sudeste-251012.osm.pbf \
  --phase1-file output/etapa1-categories-*.osm.pbf \
  --list-only

# Analisar cidade usando arquivo da Fase 1 já existente
~/.deno/bin/deno run --allow-read --allow-write --allow-run --allow-net \
  scripts/analyze-city-pois.ts omsData/sudeste-251012.osm.pbf \
  --phase1-file output/etapa1-categories-*.osm.pbf \
  --city "São Paulo"
```

## 🔍 Como Listar Todas as Cidades do PBF (Método Antigo)

### Comando Básico

```bash
# Usando caminho completo do Deno (se não estiver no PATH)
~/.deno/bin/deno run --allow-read --allow-write --allow-run \
  scripts/list-cities-from-pbf.ts omsData/sudeste-251012.osm.pbf

# Ou se Deno estiver no PATH
deno run --allow-read --allow-write --allow-run \
  scripts/list-cities-from-pbf.ts omsData/sudeste-251012.osm.pbf
```

### Salvar Lista em Arquivo JSON

```bash
deno run --allow-read --allow-write --allow-run \
  scripts/list-cities-from-pbf.ts omsData/sudeste-251012.osm.pbf \
  --output output/cities-list.json
```

### Exemplo de Saída

```
🏙️  Listando cidades do arquivo PBF
============================================================
📁 Arquivo: omsData/sudeste-251012.osm.pbf

🔍 Extraindo cidades (place=city, place=town, place=municipality)...
📊 Convertendo para GeoJSON...
📖 Processando dados...
✅ 152 cidades encontradas

📊 Estatísticas:
   Total: 152
   city: 152
   town: 781
   municipality: 1670

📋 Primeiras 20 cidades:
   1. Americana (city)
   2. Angra dos Reis (city)
   3. Araguari (city)
   ...
```

## 📊 Análise POI a POI

Após extrair os POIs de uma cidade, você terá:

1. **GeoJSON**: `output/{cidade}-pois.geojson` - Para visualização em mapas
2. **CSV**: `output/{cidade}-pois.csv` - Para análise POI a POI em planilha

### O que o Script Mostra

O script exibe estatísticas:
- Total de POIs na cidade
- Contagem por categoria (tourism, historic, natural, leisure, etc.)
- Quantidade de POIs com nome
- Percentual de POIs com nome

### Próximos Passos

1. **Abrir o CSV** e analisar cada POI
2. **Verificar quais POIs são realmente turísticos**
3. **Identificar POIs que devem ser removidos**
4. **Entender padrões**: Que tipos de POIs aparecem mas não são relevantes?

## 🏙️ Como Processar uma Cidade Específica (Método Antigo)

### Passo 1: Listar Cidades Disponíveis

```bash
deno run --allow-read --allow-write --allow-run --allow-net \
  scripts/process-city-by-city.ts omsData/sudeste-251012.osm.pbf \
  --list-only
```

Isso mostrará todas as cidades disponíveis no PBF.

### Passo 2: Processar Cidade Específica

```bash
deno run --allow-read --allow-write --allow-run --allow-net \
  scripts/process-city-by-city.ts omsData/sudeste-251012.osm.pbf \
  --city "Bragança Paulista"
```

### O que o Script Faz

1. **Busca coordenadas da cidade** via Nominatim API
2. **Extrai dados da cidade** do PBF usando bounding box
3. **Remove highways e power** (infraestrutura não relevante)
4. **Aplica filtro de turismo** com critérios:
   - Objetos com `name`
   - `leisure` (parques, estádios, etc.)
   - `aeroway` (aeroportos)
   - `tourism` (atrações turísticas)
   - `natural` importantes (com name, wikipedia, wikidata, description, website, tourism, historic)
   - `water` importantes (mesmos critérios)
5. **Gera arquivos finais**:
   - `{cidade}-tourism-{timestamp}.osm.pbf` - PBF filtrado
   - `{cidade}-tourism.geojson` - GeoJSON
   - `{cidade}-tourism.csv` - CSV

### Exemplo Completo

```bash
# 1. Listar cidades
deno run --allow-read --allow-write --allow-run --allow-net \
  scripts/process-city-by-city.ts omsData/sudeste-251012.osm.pbf \
  --list-only

# 2. Processar São Paulo
deno run --allow-read --allow-write --allow-run --allow-net \
  scripts/process-city-by-city.ts omsData/sudeste-251012.osm.pbf \
  --city "São Paulo"

# 3. Processar Campinas
deno run --allow-read --allow-read --allow-write --allow-run --allow-net \
  scripts/process-city-by-city.ts omsData/sudeste-251012.osm.pbf \
  --city "Campinas"

# 4. Processar Bragança Paulista
deno run --allow-read --allow-write --allow-run --allow-net \
  scripts/process-city-by-city.ts omsData/sudeste-251012.osm.pbf \
  --city "Bragança Paulista"
```

## 🔧 Como Funciona a Extração de Cidades

### Tags OSM para Cidades

O script identifica cidades usando as seguintes tags OSM:

- **`place=city`**: Cidades grandes (geralmente > 100k habitantes)
- **`place=town`**: Cidades médias (geralmente 10k-100k habitantes)  
- **`place=municipality`**: Municípios/administrações locais

### Limitações

1. **Não todas as cidades têm tag `place`**: Algumas cidades podem estar apenas como boundaries administrativos (`type=boundary`, `admin_level=8`)
2. **Duplicatas possíveis**: Uma cidade pode aparecer como ponto (`place=city`) E como boundary (`relation`)
3. **Nomes podem variar**: Algumas cidades podem ter nomes diferentes em diferentes objetos

### Como o Script Resolve

- Extrai apenas objetos com `place=city`, `place=town`, ou `place=municipality`
- Remove duplicatas baseado em nome+place
- Usa coordenadas do objeto para buscar bounding box via Nominatim

## 📊 Validação e Verificação

### Verificar Arquivos Gerados

Após processar uma cidade, verifique:

```bash
# Ver tamanho dos arquivos
ls -lh output/{cidade}-tourism.*

# Verificar quantidade de POIs no GeoJSON
jq '.features | length' output/{cidade}-tourism.geojson

# Verificar quantidade de POIs no CSV
wc -l output/{cidade}-tourism.csv

# Ver primeiros POIs
head -20 output/{cidade}-tourism.csv
```

### Verificar Qualidade dos POIs

```bash
# Ver categorias de POIs
jq -r '.features[].properties | "\(.tourism // .leisure // .natural // .aeroway // "outro")"' \
  output/{cidade}-tourism.geojson | sort | uniq -c | sort -rn

# Ver POIs com nome
jq -r '.features[] | select(.properties.name) | .properties.name' \
  output/{cidade}-tourism.geojson | head -20
```

## 🚀 Processamento em Lote (Futuro)

Para processar múltiplas cidades automaticamente, você pode criar um script que:

1. Lista todas as cidades
2. Itera sobre cada cidade
3. Processa uma cidade por vez
4. Salva resultados em diretórios separados

**Exemplo de estrutura de diretórios:**
```
output/
  sao-paulo/
    sao-paulo-tourism.osm.pbf
    sao-paulo-tourism.geojson
    sao-paulo-tourism.csv
  campinas/
    campinas-tourism.osm.pbf
    campinas-tourism.geojson
    campinas-tourism.csv
  braganca-paulista/
    braganca-paulista-tourism.osm.pbf
    braganca-paulista-tourism.geojson
    braganca-paulista-tourism.csv
```

## ❓ Troubleshooting

### Erro: "Cidade não encontrada"

- Verifique se o nome da cidade está correto
- Tente incluir o estado: `--city "São Paulo, SP"`
- Verifique se a cidade está no arquivo PBF usando `--list-only`

### Erro: "Nenhum POI encontrado"

- A cidade pode não ter POIs turísticos no OSM
- Verifique se o bounding box está correto
- Tente processar uma cidade maior para comparar

### Erro: "osmium-tool não encontrado"

```bash
# macOS
brew install osmctools

# Verificar
osmium --version
```

### Erro: "Deno não encontrado"

```bash
# Instalar Deno
curl -fsSL https://deno.land/install.sh | sh

# Usar caminho completo
~/.deno/bin/deno run --allow-read --allow-write --allow-run ...
```

## 📝 Notas Importantes

1. **Nominatim Rate Limiting**: A API do Nominatim tem limites de requisições. Se processar muitas cidades, pode ser necessário adicionar delays entre requisições.

2. **Arquivos Temporários**: O script cria arquivos temporários durante o processamento. Eles são limpos automaticamente, mas podem ser mantidos em caso de erro para debug.

3. **Memória**: Processar cidades grandes pode consumir bastante memória. Se encontrar problemas, considere processar cidades menores primeiro.

4. **Tempo de Processamento**: O tempo varia muito:
   - Cidades pequenas (< 100k habitantes): 1-2 minutos
   - Cidades médias (100k-500k): 3-5 minutos
   - Cidades grandes (> 500k): 5-15 minutos

## 🔗 Referências

- **OSM Place Tags**: https://wiki.openstreetmap.org/wiki/Key:place
- **OSM Administrative Boundaries**: https://wiki.openstreetmap.org/wiki/Tag:boundary%3Dadministrative
- **Nominatim API**: https://nominatim.org/release-docs/latest/api/Overview/

