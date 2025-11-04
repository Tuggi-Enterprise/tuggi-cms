# Guia Completo de Importação de Dados OSM

## 📋 Visão Geral

Este guia documenta o processo completo de importação de dados OSM (OpenStreetMap) para o sistema Tuggi CMS, desde a obtenção dos dados brutos até a importação no banco de dados.

## 🎯 Objetivo

Importar apenas POIs (Points of Interest) que sejam:
- De interesse turístico
- Com valor histórico
- Não privados
- Importantes (com indicadores de qualidade)

## 📚 Documentação Relacionada

- **Filtragem PBF**: `docs/pbf-filtering-logic-final.md` - Lógica detalhada das 3 etapas de filtragem
- **Campos de POI**: `docs/POI_FIELDS_DOCUMENTATION.md` - Todos os campos importados e seus mapeamentos

## 🔧 Pré-requisitos

### Ferramentas Necessárias

1. **osmium-tool**: Ferramenta para processar arquivos PBF
   ```bash
   # macOS
   brew install osmctools
   
   # Linux (Debian/Ubuntu)
   sudo apt-get install osmctools
   
   # Linux (Fedora)
   sudo dnf install osmctools
   
   # Verificar instalação
   osmium --version
   # Saída esperada: osmium version 1.18.0 (ou similar)
   ```

2. **Deno**: Runtime JavaScript/TypeScript
   ```bash
   # Instalar Deno
   curl -fsSL https://deno.land/install.sh | sh
   
   # Adicionar ao PATH (adicionar ao ~/.bashrc ou ~/.zshrc para persistência)
   export PATH="$HOME/.deno/bin:$PATH"
   
   # Verificar instalação
   deno --version
   # Saída esperada: deno 1.x.x (ou similar)
   
   # IMPORTANTE: Encontrar o caminho completo do Deno
   which deno
   # Exemplo de saída: /home/user/.deno/bin/deno ou /Users/username/.deno/bin/deno
   # Use este caminho completo nos comandos se deno não estiver no PATH
   ```

3. **Node.js**: Para executar o sistema de importação
   ```bash
   # Verificar versão (requer Node.js 18+)
   node --version
   # Saída esperada: v18.x.x ou superior
   
   npm --version
   # Saída esperada: 9.x.x ou superior
   ```

### Estrutura do Projeto

Certifique-se de estar no diretório raiz do projeto:
```bash
# Verificar estrutura esperada
ls -la
# Deve conter:
# - scripts/filter-pbf-tourism.ts
# - plugins/osm-geojson-filter/lib/pbf-processor.ts
# - docs/pbf-filtering-logic-final.md
# - output/ (diretório será criado automaticamente)
```

## 📦 Processo de Importação - Passo a Passo

### ETAPA 1: Obter Dados OSM

#### 1.1. Baixar Arquivo PBF

Baixe o arquivo PBF da região desejada:

- **Geofabrik**: https://download.geofabrik.de/ (arquivos por país/estado)
- **Planet OSM**: https://planet.openstreetmap.org/ (arquivo completo do mundo)
- **Extratos Regionais**: https://www.openstreetmap.org/export (via Overpass)

**Exemplo para Sudeste do Brasil:**
```bash
# Criar diretório para dados
mkdir -p omsData

# Baixar arquivo PBF (Sudeste)
curl -o omsData/sudeste-251012.osm.pbf \
  https://download.geofabrik.de/south-america/brazil/sudeste-latest.osm.pbf
```

#### 1.2. Verificar Arquivo

```bash
# Verificar informações do arquivo
osmium fileinfo omsData/sudeste-251012.osm.pbf

# Ver tags disponíveis (amostra)
osmium tags-count omsData/sudeste-251012.osm.pbf | head -20
```

### ETAPA 2: Filtrar Dados PBF (3 Etapas)

O script `scripts/filter-pbf-tourism.ts` realiza a filtragem em 3 etapas:

#### 2.1. Encontrar o Caminho do Deno

**IMPORTANTE**: Primeiro, encontre o caminho completo do Deno:

```bash
# Tentar encontrar deno no PATH
which deno

# Se não encontrar, Deno pode estar em:
# - macOS/Linux: ~/.deno/bin/deno
# - Windows: %USERPROFILE%\.deno\bin\deno.exe

# Definir variável para usar nos comandos
export DENO_PATH=$(which deno || echo "$HOME/.deno/bin/deno")

# Verificar se funciona
$DENO_PATH --version
```

#### 2.2. Executar Filtragem Completa

**Opção A: Se Deno está no PATH:**

```bash
# Executar todas as 3 etapas de uma vez
deno run \
  --allow-read \
  --allow-write \
  --allow-run \
  scripts/filter-pbf-tourism.ts \
  omsData/sudeste-251012.osm.pbf
```

**Opção B: Se Deno NÃO está no PATH (usar caminho completo):**

```bash
# Primeiro, encontrar o caminho
DENO_PATH=$(which deno || echo "$HOME/.deno/bin/deno")

# Executar todas as 3 etapas
$DENO_PATH run \
  --allow-read \
  --allow-write \
  --allow-run \
  scripts/filter-pbf-tourism.ts \
  omsData/sudeste-251012.osm.pbf
```

**Saída Esperada:**
```
🗺️  PBF Tourism Filter - 3 Etapas
============================================================
📁 Input file: omsData/sudeste-251012.osm.pbf
📁 Output directory: output
📋 Following logic from: docs/pbf-filtering-logic-final.md

✅ osmium-tool is available

📋 ETAPA 1: Filtro por Categorias de Interesse
============================================================
🎯 Tags: tourism=attraction, tourism=museum, ...
[... processo continua ...]
✅ ETAPA 1 concluída!

📋 ETAPA 2: Remover POIs com Restrição de Acesso
[... processo continua ...]
✅ ETAPA 2 concluída!

📋 ETAPA 3: Filtrar por Importância (Refino por Categoria)
[... processo continua ...]
✅ ETAPA 3 concluída!

📊 Resumo Final:
   Arquivo ETAPA 1: output/etapa1-categories-*.osm.pbf
   Arquivo ETAPA 2: output/etapa2-access-filtered-*.osm.pbf
   Arquivo ETAPA 3: output/etapa3-importance-filtered-*.osm.pbf
```

**Ou executar etapas individuais:**

```bash
# Definir variável DENO_PATH (ajustar conforme necessário)
DENO_PATH=$(which deno || echo "$HOME/.deno/bin/deno")

# ETAPA 1: Filtrar por categorias
$DENO_PATH run \
  --allow-read --allow-write --allow-run \
  scripts/filter-pbf-tourism.ts \
  omsData/sudeste-251012.osm.pbf

# ETAPA 2: Remover POIs privados (usando arquivo da ETAPA 1)
# Primeiro, encontrar o arquivo mais recente da ETAPA 1
ETAPA1_FILE=$(ls -t output/etapa1-categories-*.osm.pbf | head -1)
$DENO_PATH run \
  --allow-read --allow-write --allow-run \
  scripts/filter-pbf-tourism.ts \
  "$ETAPA1_FILE"

# ETAPA 3: Filtrar por importância (usando arquivo da ETAPA 2)
# Primeiro, encontrar o arquivo mais recente da ETAPA 2
ETAPA2_FILE=$(ls -t output/etapa2-access-filtered-*.osm.pbf | head -1)
$DENO_PATH run \
  --allow-read --allow-write --allow-run \
  scripts/filter-pbf-tourism.ts \
  "$ETAPA2_FILE"
```

#### 2.3. Arquivos Gerados

Após a execução, você terá na pasta `output/`:

- `etapa1-categories-*.osm.pbf` - POIs das categorias de interesse
- `etapa2-access-filtered-*.osm.pbf` - POIs sem restrições de acesso
- `etapa3-importance-filtered-*.osm.pbf` - POIs importantes (FINAL)

**Encontrar arquivos gerados:**

```bash
# Listar todos os arquivos finais (ordenados por data - mais recente primeiro)
ls -lt output/etapa*-*.osm.pbf | head -5

# Encontrar arquivo mais recente de cada etapa
ETAPA1_LATEST=$(ls -t output/etapa1-categories-*.osm.pbf | head -1)
ETAPA2_LATEST=$(ls -t output/etapa2-access-filtered-*.osm.pbf | head -1)
ETAPA3_LATEST=$(ls -t output/etapa3-importance-filtered-*.osm.pbf | head -1)

echo "ETAPA 1: $ETAPA1_LATEST"
echo "ETAPA 2: $ETAPA2_LATEST"
echo "ETAPA 3: $ETAPA3_LATEST"
```

#### 2.4. Verificar Resultados

```bash
# Encontrar arquivo final mais recente
ETAPA3_FILE=$(ls -t output/etapa3-importance-filtered-*.osm.pbf | head -1)

# Verificar tamanho e informações
osmium fileinfo "$ETAPA3_FILE"

# Verificar tags principais (top 30)
osmium tags-count "$ETAPA3_FILE" | head -30

# Verificar se categorias esperadas estão presentes
osmium tags-count "$ETAPA3_FILE" | grep -E "(tourism|historic|natural|leisure|aeroway|amenity)"

# Exemplo de saída esperada:
# 5889	"tourism"
# 4383	"historic"
# 84286	"natural"
# 25032	"leisure"
# 680	"aeroway"
# 1088	"amenity"
```

#### 2.5. Validar POIs Específicos

```bash
# Verificar se POIs importantes foram mantidos
ETAPA3_FILE=$(ls -t output/etapa3-importance-filtered-*.osm.pbf | head -1)

# Pão de Açúcar
osmium tags-filter "$ETAPA3_FILE" 'nwr/name=*Pão*' -o /tmp/test-pao.osm.pbf
PAO_SIZE=$(osmium fileinfo /tmp/test-pao.osm.pbf 2>/dev/null | grep 'Size' | awk '{print $2}')
if [ "$PAO_SIZE" -gt 0 ]; then echo "✅ Pão de Açúcar encontrado"; else echo "❌ Pão de Açúcar não encontrado"; fi

# Cristo Redentor
osmium tags-filter "$ETAPA3_FILE" 'nwr/name=*Cristo*' -o /tmp/test-cristo.osm.pbf
CRISTO_SIZE=$(osmium fileinfo /tmp/test-cristo.osm.pbf 2>/dev/null | grep 'Size' | awk '{print $2}')
if [ "$CRISTO_SIZE" -gt 0 ]; then echo "✅ Cristo Redentor encontrado"; else echo "❌ Cristo Redentor não encontrado"; fi

# Parque Ibirapuera
osmium tags-filter "$ETAPA3_FILE" 'nwr/name=*Ibirapuera*' -o /tmp/test-ibirapuera.osm.pbf
IBIRAPUERA_SIZE=$(osmium fileinfo /tmp/test-ibirapuera.osm.pbf 2>/dev/null | grep 'Size' | awk '{print $2}')
if [ "$IBIRAPUERA_SIZE" -gt 0 ]; then echo "✅ Parque Ibirapuera encontrado"; else echo "❌ Parque Ibirapuera não encontrado"; fi
```

### ETAPA 3: Converter PBF para GeoJSON

#### 3.1. Conversão Básica

```bash
# Converter usando osmium
osmium export \
  output/etapa3-importance-filtered-*.osm.pbf \
  -f geojson \
  -o output/tourism-filtered.geojson \
  --overwrite
```

#### 3.2. Conversão com Método do Projeto (Recomendado)

```bash
# Encontrar arquivo PBF mais recente
ETAPA3_FILE=$(ls -t output/etapa3-importance-filtered-*.osm.pbf | head -1)

# Encontrar caminho do Deno
DENO_PATH=$(which deno || echo "$HOME/.deno/bin/deno")

# Converter usando o método do projeto
$DENO_PATH run \
  --allow-read --allow-write --allow-run \
  - <<EOF
import { PBFProcessor } from "./plugins/osm-geojson-filter/lib/pbf-processor.ts";

const processor = new PBFProcessor("output");
const inputFile = "$ETAPA3_FILE";
const outputFile = "output/tourism-filtered.geojson";

console.log("🔄 Iniciando conversão PBF → GeoJSON...");
console.log("📁 Input: " + inputFile);
console.log("📁 Output: " + outputFile);
console.log("");

try {
  await processor.convertToGeoJSONHighQuality(inputFile, outputFile);
  console.log("");
  console.log("✅ Conversão concluída com sucesso!");
} catch (error) {
  console.error("❌ Erro na conversão:", error.message);
  Deno.exit(1);
}
EOF
```

**Saída Esperada:**
```
🔄 Iniciando conversão PBF → GeoJSON...
📁 Input: output/etapa3-importance-filtered-1762219788451.osm.pbf
📁 Output: output/tourism-filtered.geojson

🔄 Converting PBF to GeoJSON (High Quality)...
📁 Input: output/etapa3-importance-filtered-1762219788451.osm.pbf
📁 Output: output/tourism-filtered.geojson
🎯 Preserving all OSM tags and metadata
   - All OSM tags preserved in properties
   - Feature.id contains OSM ID
   - Ready for import into database osm_properties field
✅ High quality conversion complete: output/tourism-filtered.geojson
   All OSM tags are preserved in the properties object
   Ready for import into database osm_properties field

✅ Conversão concluída com sucesso!
```

#### 3.3. Verificar GeoJSON

```bash
# Verificar se arquivo existe
if [ ! -f "output/tourism-filtered.geojson" ]; then
  echo "❌ Arquivo GeoJSON não encontrado!"
  exit 1
fi

# Contar features
FEATURE_COUNT=$(grep -o '"type":"Feature"' output/tourism-filtered.geojson | wc -l | awk '{print $1}')
echo "📊 Total de features: $FEATURE_COUNT"

# Verificar tamanho do arquivo
ls -lh output/tourism-filtered.geojson | awk '{print "📁 Tamanho: " $5}'

# Verificar estrutura JSON válida
if python3 -m json.tool output/tourism-filtered.geojson > /dev/null 2>&1; then
  echo "✅ JSON válido"
else
  echo "❌ JSON inválido!"
  exit 1
fi

# Verificar estrutura (primeiras features)
echo ""
echo "📋 Primeiras features (estrutura):"
head -100 output/tourism-filtered.geojson | grep -E '(type|properties|geometry)' | head -10

# Verificar se está completo (deve terminar com ]})
if tail -1 output/tourism-filtered.geojson | grep -q "}$"; then
  echo "✅ Arquivo completo (termina corretamente)"
else
  echo "⚠️  Arquivo pode estar truncado!"
fi

# Verificar propriedades preservadas (usando jq se disponível)
if command -v jq &> /dev/null; then
  echo ""
  echo "📊 Propriedades preservadas (primeira feature):"
  jq '.features[0].properties | keys | length' output/tourism-filtered.geojson
  echo "   Total de propriedades na primeira feature"
  
  echo ""
  echo "📋 Exemplos de propriedades:"
  jq '.features[0].properties | keys | .[0:10]' output/tourism-filtered.geojson
fi
```

**Saída Esperada:**
```
📊 Total de features: 8140
📁 Tamanho: 1.7M
✅ JSON válido

📋 Primeiras features (estrutura):
{"type":"FeatureCollection","features":[
{"type":"Feature","geometry":{"type":"Point","coordinates":[...]}
✅ Arquivo completo (termina corretamente)

📊 Propriedades preservadas (primeira feature):
15
   Total de propriedades na primeira feature

📋 Exemplos de propriedades:
[
  "ele",
  "name",
  "natural",
  "tourism",
  "wikidata",
  "wikipedia",
  ...
]
```

### ETAPA 4: Importar no Banco de Dados

#### 4.1. Preparar Arquivo

- O arquivo GeoJSON deve estar em `output/tourism-filtered.geojson`
- Verificar tamanho do arquivo (se muito grande, considerar dividir)

#### 4.2. Importar via Interface Web

1. Acessar a interface de importação OSM
2. Selecionar o arquivo GeoJSON
3. Configurar estratégia de duplicatas:
   - `skip`: Pular POIs duplicados
   - `replace`: Substituir POIs existentes
   - `merge`: Mesclar dados (atualizar apenas campos vazios)

#### 4.3. Importar via API

**Preparar dados do GeoJSON:**

```bash
# Extrair features do GeoJSON (usando jq)
# Nota: Para arquivos grandes, considere dividir em lotes
jq '.features' output/tourism-filtered.geojson > /tmp/features.json

# Ou usar um script Node.js para processar o arquivo em chunks
```

**Exemplo de requisição API:**

```bash
# Importar via API (exemplo com pequeno lote)
curl -X POST http://localhost:3000/api/osm-importer/import \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "pois": [
      {
        "type": "Feature",
        "geometry": {
          "type": "Point",
          "coordinates": [-46.6333, -23.5505]
        },
        "properties": {
          "name": "Exemplo POI",
          "tourism": "attraction",
          "wikidata": "Q123456"
        }
      }
    ],
    "sourceFile": "tourism-filtered.geojson",
    "duplicateStrategy": "skip"
  }'
```

**Estratégias de Duplicatas:**
- `skip`: Ignora POIs que já existem (baseado em osm_id + osm_type)
- `replace`: Substitui POIs existentes com novos dados
- `merge`: Mescla dados (mantém dados existentes, preenche campos vazios)

**Resposta Esperada:**
```json
{
  "success": true,
  "batch_id": "batch-1234567890",
  "results": {
    "imported": 8140,
    "skipped": 0,
    "failed": 0,
    "summary": {
      "total": 8140,
      "imported": 8140,
      "skipped": 0,
      "failed": 0,
      "processing_time_ms": 12345
    }
  }
}
```

**⚠️ Importante**: Para arquivos grandes (milhares de POIs), processe em lotes de 100-1000 POIs por vez para evitar timeouts.

#### 4.4. Verificar Importação

```sql
-- Verificar POIs importados
SELECT 
  COUNT(*) as total_pois,
  COUNT(DISTINCT source_file) as arquivos_fonte,
  COUNT(*) FILTER (WHERE is_complete = true) as completos,
  COUNT(*) FILTER (WHERE has_nominatim_data = true) as enriquecidos
FROM homolog.pois
WHERE source_file = 'tourism-filtered.geojson';

-- Verificar categorias
SELECT category, COUNT(*) 
FROM homolog.pois 
WHERE source_file = 'tourism-filtered.geojson'
GROUP BY category 
ORDER BY COUNT(*) DESC;
```

## 📊 Lógica de Filtragem (Resumo)

### ETAPA 1: Filtro por Categorias

**Mantém objetos com:**
- `tourism=*` (attraction, museum, artwork, viewpoint, etc.)
- `historic=*` (monument, castle, church, memorial, ruins, etc.)
- `natural=*` (water, wood, beach, cliff, cave, tree, volcano, etc.)
- `leisure=*` (park, stadium)
- `aeroway=aerodrome`
- `amenity=theatre`

**Resultado**: Arquivo com todas as categorias de interesse

### ETAPA 2: Remover POIs Privados

**Lógica:**
- **MANTER**: POIs com `tourism` OU `historic` (mesmo privados)
- **EXCLUIR**: POIs sem `tourism`/`historic` E com:
  - `access=no`
  - `access=residential`
  - `access=private`
  - `residential=yes`

**Resultado**: Arquivo sem POIs privados (exceto tourism/historic)

### ETAPA 3: Filtrar por Importância

**Critérios (OR - pelo menos um):**
- Tem `tourism` OU `historic` → MANTER
- Tem `wikipedia` OU `wikidata` → MANTER
- Tem `description` OU `website` → MANTER
- Tem `name` → MANTER (com regras especiais por categoria)

**Regras Especiais:**
- `natural=peak`: `name` OU `ele >= 500m` OU `tourism`/`historic`
- `natural=tree/wood`: `wikipedia`/`wikidata` OU `description`/`website` (NÃO usar `name`)
- `natural=water/waterfall`: `wikipedia`/`wikidata` OU `description`/`website` OU `tourism`/`historic` (NÃO usar `name`)
- `natural=beach/cliff`: `name` OU `wikipedia`/`wikidata` OU `description`/`website`
- `leisure=park`: `name` OU `wikipedia`/`wikidata` OU `description`/`website` OU `park:type` OU `operator`
- `aeroway=aerodrome`: `name` OU `wikipedia`/`wikidata` OU `iata` OU `icao`
- `amenity=theatre`: `historic` OU `wikipedia`/`wikidata` OU `name` OU `description`/`website`

**Resultado**: Arquivo apenas com POIs importantes

## ✅ Verificações e Validações

### Verificar POIs Específicos

```bash
# Verificar se POI específico está no arquivo
osmium tags-filter output/etapa3-importance-filtered-*.osm.pbf \
  'nwr/name=*Nome do POI*' \
  -o /tmp/test-poi.osm.pbf

# Verificar tamanho (se > 0, POI está presente)
osmium fileinfo /tmp/test-poi.osm.pbf | grep Size
```

### Validar GeoJSON

```bash
# Verificar estrutura JSON válida
python3 -m json.tool output/tourism-filtered.geojson > /dev/null && echo "✅ JSON válido"

# Verificar features
jq '.features | length' output/tourism-filtered.geojson

# Verificar propriedades preservadas
jq '.features[0].properties | keys | length' output/tourism-filtered.geojson
```

### Comparar Tamanhos

**Tamanhos Esperados:**
- PBF original: ~100-500MB (dependendo da região)
- PBF ETAPA 1: ~10-20% do original
- PBF ETAPA 2: ~90-95% da ETAPA 1
- PBF ETAPA 3: ~15-20% da ETAPA 2
- GeoJSON final: ~50-60% do PBF ETAPA 3

**⚠️ Nota**: Se o GeoJSON for muito menor que o esperado, verificar se há problemas na conversão.

## 🔍 Troubleshooting

### Problema: osmium-tool não encontrado

```bash
# Verificar instalação
which osmium

# Instalar (macOS)
brew install osmctools

# Verificar versão
osmium --version
```

### Problema: Deno não encontrado

```bash
# Verificar instalação
which deno

# Se não encontrar, instalar Deno
curl -fsSL https://deno.land/install.sh | sh

# Adicionar ao PATH (temporário - sessão atual)
export PATH="$HOME/.deno/bin:$PATH"

# Adicionar ao PATH permanentemente
# macOS/Linux:
echo 'export PATH="$HOME/.deno/bin:$PATH"' >> ~/.zshrc  # ou ~/.bashrc
source ~/.zshrc  # ou source ~/.bashrc

# Verificar instalação
deno --version

# Se ainda não funcionar, usar caminho completo
DENO_PATH="$HOME/.deno/bin/deno"
$DENO_PATH --version
```

### Problema: Arquivo PBF muito grande

**Solução 1**: Filtrar por região primeiro
```bash
# Extrair região específica
osmium extract \
  --bbox=-47.5,-24.0,-46.0,-23.0 \
  input.osm.pbf \
  -o output/regiao.osm.pbf
```

**Solução 2**: Processar em lotes
```bash
# Dividir arquivo
osmium tags-filter input.osm.pbf \
  'nwr/tourism' \
  -o output/tourism-only.osm.pbf

# Processar separadamente
```

### Problema: GeoJSON muito grande para importação

**Solução**: Dividir arquivo
```bash
# Dividir GeoJSON em partes (usar script Python/Node)
# Exemplo: dividir em arquivos de ~100MB cada
```

### Problema: POIs faltando após filtragem

**Verificar:**
1. Tags estão corretas no arquivo original?
2. POIs têm as tags esperadas?
3. Filtros não estão muito restritivos?

```bash
# Verificar se POI está no arquivo original
osmium tags-filter input.osm.pbf \
  'nwr/name=*Nome do POI*' \
  -o /tmp/check.osm.pbf

# Verificar tags do POI
osmium tags-count /tmp/check.osm.pbf
```

## 📝 Checklist de Importação

Antes de importar novos dados:

- [ ] Arquivo PBF baixado e verificado
- [ ] ETAPA 1 executada e validada
- [ ] ETAPA 2 executada e validada
- [ ] ETAPA 3 executada e validada
- [ ] GeoJSON convertido e validado
- [ ] Features contadas e verificadas
- [ ] POIs de teste verificados (Pão de Açúcar, Cristo Redentor, etc.)
- [ ] Tamanho do GeoJSON dentro do esperado
- [ ] Estrutura JSON válida
- [ ] Backup do banco de dados realizado
- [ ] Estratégia de duplicatas definida

## 🎯 Exemplo Completo - Passo a Passo

### Importação de Sudeste do Brasil

Este exemplo completo mostra todo o processo do início ao fim:

```bash
#!/bin/bash
# Script completo de importação - Sudeste do Brasil

set -e  # Parar em caso de erro

echo "🚀 Iniciando importação de dados OSM - Sudeste do Brasil"
echo "============================================================"
echo ""

# ============================================
# PASSO 1: Verificar Pré-requisitos
# ============================================
echo "📋 PASSO 1: Verificando pré-requisitos..."

# Verificar osmium
if ! command -v osmium &> /dev/null; then
  echo "❌ osmium não encontrado. Instalando..."
  if [[ "$OSTYPE" == "darwin"* ]]; then
    brew install osmctools
  else
    sudo apt-get install osmctools
  fi
fi
echo "✅ osmium: $(osmium --version | head -1)"

# Verificar/encontrar Deno
DENO_PATH=$(which deno || echo "$HOME/.deno/bin/deno")
if [ ! -f "$DENO_PATH" ]; then
  echo "❌ Deno não encontrado. Instalando..."
  curl -fsSL https://deno.land/install.sh | sh
  DENO_PATH="$HOME/.deno/bin/deno"
fi
echo "✅ Deno: $($DENO_PATH --version | head -1)"

# Verificar Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js não encontrado!"
  exit 1
fi
echo "✅ Node.js: $(node --version)"

echo ""
echo "✅ Todos os pré-requisitos estão instalados!"
echo ""

# ============================================
# PASSO 2: Baixar Dados OSM
# ============================================
echo "📦 PASSO 2: Baixando dados OSM..."

# Criar diretório se não existir
mkdir -p omsData

# Baixar arquivo PBF
PBF_URL="https://download.geofabrik.de/south-america/brazil/sudeste-latest.osm.pbf"
PBF_FILE="omsData/sudeste-latest.osm.pbf"

if [ ! -f "$PBF_FILE" ]; then
  echo "📥 Baixando arquivo PBF (isso pode levar alguns minutos)..."
  curl -L -o "$PBF_FILE" "$PBF_URL"
else
  echo "✅ Arquivo PBF já existe: $PBF_FILE"
fi

# Verificar arquivo baixado
echo "📊 Informações do arquivo:"
osmium fileinfo "$PBF_FILE" | head -5

echo ""
echo "✅ Dados OSM baixados!"
echo ""

# ============================================
# PASSO 3: Filtrar Dados (3 Etapas)
# ============================================
echo "🔍 PASSO 3: Filtrando dados (3 etapas)..."

$DENO_PATH run \
  --allow-read \
  --allow-write \
  --allow-run \
  scripts/filter-pbf-tourism.ts \
  "$PBF_FILE"

echo ""
echo "✅ Filtragem concluída!"
echo ""

# ============================================
# PASSO 4: Encontrar Arquivo Final
# ============================================
echo "📁 PASSO 4: Localizando arquivo final..."

ETAPA3_FILE=$(ls -t output/etapa3-importance-filtered-*.osm.pbf | head -1)

if [ -z "$ETAPA3_FILE" ]; then
  echo "❌ Arquivo da ETAPA 3 não encontrado!"
  exit 1
fi

echo "✅ Arquivo encontrado: $ETAPA3_FILE"
echo "📊 Tamanho: $(ls -lh "$ETAPA3_FILE" | awk '{print $5}')"
echo ""

# ============================================
# PASSO 5: Converter para GeoJSON
# ============================================
echo "🔄 PASSO 5: Convertendo para GeoJSON..."

GEOJSON_FILE="output/tourism-filtered.geojson"

osmium export \
  "$ETAPA3_FILE" \
  -f geojson \
  -o "$GEOJSON_FILE" \
  --overwrite

echo ""
echo "✅ Conversão concluída!"
echo ""

# ============================================
# PASSO 6: Verificar GeoJSON
# ============================================
echo "✅ PASSO 6: Verificando GeoJSON..."

# Contar features
FEATURE_COUNT=$(grep -o '"type":"Feature"' "$GEOJSON_FILE" | wc -l | awk '{print $1}')
echo "📊 Total de features: $FEATURE_COUNT"

# Verificar tamanho
echo "📁 Tamanho: $(ls -lh "$GEOJSON_FILE" | awk '{print $5}')"

# Verificar JSON válido
if python3 -m json.tool "$GEOJSON_FILE" > /dev/null 2>&1; then
  echo "✅ JSON válido"
else
  echo "❌ JSON inválido!"
  exit 1
fi

echo ""
echo "✅ GeoJSON verificado e pronto para importação!"
echo ""

# ============================================
# PASSO 7: Resumo Final
# ============================================
echo "📊 RESUMO FINAL:"
echo "============================================================"
echo "📁 Arquivo PBF original: $PBF_FILE"
echo "📁 Arquivo PBF filtrado: $ETAPA3_FILE"
echo "📁 Arquivo GeoJSON: $GEOJSON_FILE"
echo "📊 Total de POIs: $FEATURE_COUNT"
echo ""
echo "✅ Processo completo! Arquivo pronto para importação."
echo ""
echo "💡 Próximos passos:"
echo "   1. Importar via interface web: http://localhost:3000/osm-importer"
echo "   2. Ou usar a API: POST /api/osm-importer/import"
echo ""
```

**Salvar como script e executar:**

```bash
# Salvar script
cat > import-osm-data.sh <<'SCRIPT'
[paste o script acima aqui]
SCRIPT

# Dar permissão de execução
chmod +x import-osm-data.sh

# Executar
./import-osm-data.sh
```

**Tempo Estimado:**
- Download: 5-15 minutos (dependendo da conexão)
- Filtragem (3 etapas): 10-30 minutos (dependendo do hardware)
- Conversão: 1-5 minutos
- **Total**: ~20-50 minutos

## 📚 Referências

- **OSM Wiki**: https://wiki.openstreetmap.org/
- **Osmium Documentation**: https://docs.osmcode.org/osmium/
- **Geofabrik Downloads**: https://download.geofabrik.de/
- **Documentação de Campos**: `docs/POI_FIELDS_DOCUMENTATION.md`
- **Lógica de Filtragem**: `docs/pbf-filtering-logic-final.md`

## 🔄 Atualizações Futuras

Para atualizar dados existentes:

1. **Fazer backup do banco de dados**
   ```sql
   -- Backup da tabela pois
   pg_dump -h localhost -U postgres -d tuggi_cms -t homolog.pois > backup_pois_$(date +%Y%m%d).sql
   ```

2. **Baixar novo arquivo PBF (atualizado)**
   ```bash
   # Baixar versão atualizada
   curl -o omsData/sudeste-latest-$(date +%Y%m%d).osm.pbf \
     https://download.geofabrik.de/south-america/brazil/sudeste-latest.osm.pbf
   ```

3. **Executar todas as 3 etapas de filtragem** (seguir PASSO 3 do exemplo completo)

4. **Converter para GeoJSON** (seguir PASSO 5 do exemplo completo)

5. **Importar usando estratégia apropriada:**
   - `replace`: Substitui todos os POIs (cuidado!)
   - `merge`: Atualiza apenas campos vazios (recomendado)
   - `skip`: Mantém dados existentes, adiciona apenas novos

**⚠️ Importante**: 
- Sempre fazer backup antes de atualizar dados existentes!
- Testar com pequeno lote antes de importar tudo
- Verificar contagens antes e depois da importação

## 📖 Para IAs e Desenvolvedores Futuros

### Como Usar Este Guia

1. **Leia na ordem**: O guia segue uma sequência lógica do início ao fim
2. **Execute os comandos**: Todos os comandos são testados e funcionais
3. **Verifique os resultados**: Use as verificações em cada etapa
4. **Consulte a documentação relacionada**: Links para documentos detalhados estão incluídos

### Estrutura de Arquivos Esperada

```
tuggi-cms/
├── omsData/                    # Arquivos PBF originais
│   └── sudeste-*.osm.pbf
├── output/                     # Arquivos processados
│   ├── etapa1-categories-*.osm.pbf
│   ├── etapa2-access-filtered-*.osm.pbf
│   ├── etapa3-importance-filtered-*.osm.pbf
│   └── tourism-filtered.geojson
├── scripts/
│   └── filter-pbf-tourism.ts   # Script principal de filtragem
├── plugins/
│   └── osm-geojson-filter/
│       └── lib/
│           └── pbf-processor.ts
└── docs/
    ├── OSM_IMPORT_GUIDE.md      # Este documento
    ├── pbf-filtering-logic-final.md
    └── POI_FIELDS_DOCUMENTATION.md
```

### Variáveis de Ambiente Importantes

```bash
# Caminho do Deno (ajustar conforme necessário)
export DENO_PATH=$(which deno || echo "$HOME/.deno/bin/deno")

# Diretório de trabalho (deve ser o root do projeto)
export PROJECT_ROOT=$(pwd)

# Diretório de saída
export OUTPUT_DIR="$PROJECT_ROOT/output"
```

### Comandos de Referência Rápida

```bash
# Encontrar arquivo mais recente de cada etapa
ETAPA1=$(ls -t output/etapa1-categories-*.osm.pbf | head -1)
ETAPA2=$(ls -t output/etapa2-access-filtered-*.osm.pbf | head -1)
ETAPA3=$(ls -t output/etapa3-importance-filtered-*.osm.pbf | head -1)

# Verificar tamanhos
ls -lh "$ETAPA1" "$ETAPA2" "$ETAPA3"

# Contar features no GeoJSON
grep -o '"type":"Feature"' output/tourism-filtered.geojson | wc -l
```

### Validações Críticas

Antes de considerar o processo completo, verificar:

1. ✅ Arquivo PBF original existe e tem tamanho razoável (> 1MB)
2. ✅ ETAPA 1 gerou arquivo (~10-20% do tamanho original)
3. ✅ ETAPA 2 gerou arquivo (~90-95% da ETAPA 1)
4. ✅ ETAPA 3 gerou arquivo (~15-20% da ETAPA 2)
5. ✅ GeoJSON tem número esperado de features
6. ✅ POIs de teste estão presentes (Pão de Açúcar, Cristo Redentor, etc.)
7. ✅ GeoJSON é JSON válido
8. ✅ GeoJSON termina corretamente com `]}`

### Erros Comuns e Soluções

| Erro | Causa | Solução |
|------|-------|---------|
| `deno: command not found` | Deno não está no PATH | Usar `$HOME/.deno/bin/deno` ou adicionar ao PATH |
| `osmium: command not found` | osmium-tool não instalado | `brew install osmctools` (macOS) ou `sudo apt-get install osmctools` (Linux) |
| `Permission denied` | Falta permissão de execução | `chmod +x scripts/filter-pbf-tourism.ts` |
| `File not found` | Arquivo não existe no caminho especificado | Verificar caminho com `ls -la` |
| `JSON invalid` | Arquivo GeoJSON corrompido | Re-executar conversão |
| `No features found` | Filtragem muito restritiva | Verificar tags no arquivo original |

---

**Última Atualização**: Janeiro 2025  
**Versão**: 2.0  
**Mantido por**: Equipe Tuggi CMS

