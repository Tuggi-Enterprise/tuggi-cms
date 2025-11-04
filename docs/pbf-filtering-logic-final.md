# Lógica Final de Filtragem PBF - Apenas Pontos com Valor

## Escopo
- **Fase 1 (atual)**: Apenas **nodes/points** (não ways)
- **Fase 2 (futuro)**: Ways importantes (separado)

## Objetivo
Criar arquivo PBF com apenas **pontos** que sejam:
1. De interesse turístico
2. Com valor histórico
3. **NÃO privados**

## Lógica de Filtragem - 3 Etapas

### ETAPA 1: Filtro por Categorias de Interesse
**Manter apenas objetos com pelo menos UMA das categorias:**
- `tourism=*` (qualquer valor)
- `historic=*` (qualquer valor - inclui historic=train_station, historic=building, historic=house, historic=bridge)
- `natural=*` (qualquer valor)
- `leisure=*` (qualquer valor)
- `aeroway=aerodrome`
- `amenity=theatre` (teatros - serão filtrados na Etapa 3 por importância)

**Categorias específicas incluídas:**
- `tourism=attraction`, `tourism=museum`, `tourism=artwork`, `tourism=viewpoint`, `tourism=theme_park`, `tourism=zoo`, `tourism=aquarium`
- `historic=monument`, `historic=castle`, `historic=church`, `historic=memorial`, `historic=ruins`, `historic=archaeological_site`, `historic=fort`, `historic=tomb`, `historic=wayside_shrine`, `historic=train_station`, `historic=building`, `historic=house`, `historic=bridge`
- `natural=water`, `natural=wood`, `natural=beach`, `natural=cliff`, `natural=cave`, `natural=tree`, `natural=volcano`, `natural=waterfall`, `natural=geyser`, `natural=hot_spring`
- `leisure=park`, `leisure=stadium`
- `aeroway=aerodrome`
- `amenity=theatre`

**Resultado**: Arquivo com todas as categorias de interesse

### ETAPA 2: Remover POIs com Restrição de Acesso (Ajustado)

**Critério**: Sempre verificar se o POI é turístico ou histórico antes de excluir por acesso.

**Regra Geral**: 
- Se tem `tourism` OU `historic` → ✅ **MANTER** (mesmo com restrições de acesso)
- Se NÃO tem `tourism`/`historic` → Verificar acesso abaixo

**Excluir se (NÃO tem tourism/historic E):**
- `access=no` (sem acesso público)
- `access=residential` (acesso residencial)
- `residential=yes` (área residencial)
- `access=private` (acesso privado)

**Manter se:**
- Tem `tourism` OU `historic` (mesmo com qualquer restrição de acesso)
- OU não tem restrições de acesso

**Resultado**: Arquivo mantém POIs turísticos/históricos mesmo com restrições de acesso

### ETAPA 3: Filtrar por Importância (Refino)

#### Regra Geral: POI é importante se tem pelo menos UM indicador:

**Indicador 1: Tem categoria de turismo/histórico** ✅
- `tourism=*` (já incluído na Etapa 1)
- `historic=*` (já incluído na Etapa 1)
- **Conclusão**: Se tem tourism ou historic, já é importante por definição

**Indicador 2: Tem referência externa** ✅
- `wikipedia` (qualquer valor)
- `wikidata` (qualquer valor)
- **Conclusão**: Se tem referência externa, é importante

**Indicador 3: É nomeado** ⚠️ (OPCIONAL)
- `name` (qualquer valor, não vazio)
- **Nota**: Na importação, POIs sem nome são verificados no Nominatim e excluídos se não encontrados
- **Decisão**: Não excluir no filtro PBF (será filtrado na importação)
- **Conclusão**: POIs sem nome podem ser mantidos no PBF (serão filtrados depois)

**Indicador 4: Tem descrição/website** ✅
- `description` (qualquer valor)
- `website` (qualquer valor)
- **Conclusão**: Se foi documentado, é importante

#### Regras Especiais por Categoria:

##### Para NATURAL=PEAK (picos):
**Manter se:**
- Tem `tourism=*` OU `historic=*` (já importante - mesmo sem name)
- OU tem `wikipedia` OU `wikidata` (referência externa)
- OU tem `description` OU `website` (documentado)
- OU tem `name` (nomeado - será verificado na importação)
- OU (`ele >= 500m` E `name`) (pico alto nomeado)

**Excluir se:**
- `natural=peak` SEM `name` E SEM referências E SEM `tourism`/`historic` E SEM `description`/`website` E SEM (`ele >= 500m` E `name`) (genérico)

**Nota**: Picos com `tourism`/`historic` são mantidos mesmo sem `name`, pois podem ser importantes e o nome será buscado no Nominatim na importação.

**Exemplos:**
- ✅ `natural=peak` + `name` → MANTER (Pico do Jaraguá)
- ✅ `natural=peak` + `wikipedia` → MANTER
- ✅ `natural=peak` + `tourism=attraction` (sem name) → MANTER (importante)
- ✅ `natural=peak` + `ele=1135m` + `name` → MANTER (pico alto nomeado)
- ❌ `natural=peak` + `ele=600m` (sem name) → EXCLUIR (pico alto genérico)
- ❌ `natural=peak` sem name/referências/tourism/historic → EXCLUIR (genérico)

##### Para NATURAL=WATER e NATURAL=WATERFALL (corpos d'água e cachoeiras):
**Manter se:**
- Tem `tourism=*` OU `historic=*` (já importante)
- OU tem `wikipedia` OU `wikidata` (referência externa)
- OU tem `description` OU `website` (documentado)

**Excluir se:**
- `natural=water` OU `natural=waterfall` SEM `tourism`/`historic` E SEM referências E SEM `description`/`website` (genérico)

**Nota**: NÃO incluir apenas `name` como critério para water/waterfall, pois muitos corpos d'água nomeados são genéricos e podem estar no meio do mato, sem acesso/valor para turistas na estrada.

**Exemplos:**
- ✅ `natural=waterfall` + `tourism=attraction` → MANTER (cachoeira turística)
- ✅ `natural=water` + `wikipedia` → MANTER (referência externa)
- ❌ `natural=water` + apenas `name` → EXCLUIR (genérico, pode estar no mato)
- ❌ `natural=waterfall` + apenas `name` → EXCLUIR (genérico, pode estar no mato)

##### Para NATURAL=TREE (árvores):
**Manter se:**
- Tem `tourism=*` OU `historic=*` (já importante)
- OU tem `wikipedia` OU `wikidata` (referência externa)
- OU tem `description` OU `website` (documentado)

**Excluir se:**
- `natural=tree` SEM `tourism`/`historic` E SEM referências E SEM `description`/`website` (genérico)

**Nota**: NÃO incluir apenas `name` como critério para `natural=tree`, pois há 172.917 árvores e a maioria (99.86%) são genéricas. Apenas árvores realmente importantes (com referências ou tourism/historic) devem ser mantidas.

**Exemplos:**
- ✅ `natural=tree` + `tourism=attraction` → MANTER (árvore turística)
- ✅ `natural=tree` + `wikipedia` → MANTER (árvore famosa)
- ❌ `natural=tree` + apenas `name` → EXCLUIR (árvore genérica no mato)

##### Para NATURAL=WOOD (madeiras/bosques):
**Manter se:**
- Tem `tourism=*` OU `historic=*` (já importante)
- OU tem `wikipedia` OU `wikidata` (referência externa)
- OU tem `description` OU `website` (documentado)

**Excluir se:**
- `natural=wood` SEM `tourism`/`historic` E SEM referências E SEM `description`/`website` (genérico)

**Nota**: NÃO incluir apenas `name` como critério para `natural=wood`, pois há 340.254 objetos e a maioria são genéricos. Apenas bosques realmente importantes devem ser mantidos.

**Exemplos:**
- ✅ `natural=wood` + `tourism=attraction` → MANTER (bosque turístico)
- ✅ `natural=wood` + `wikipedia` → MANTER (bosque famoso)
- ❌ `natural=wood` + apenas `name` → EXCLUIR (bosque genérico no mato)

##### Para NATURAL=BEACH (praias):
**Manter se:**
- Tem `tourism=*` OU `historic=*` (já importante)
- OU tem `wikipedia` OU `wikidata` (referência externa)
- OU tem `description` OU `website` (documentado)
- OU tem `name` (praia nomeada - será verificado na importação)

**Excluir se:**
- `natural=beach` SEM `name` E SEM referências E SEM `tourism`/`historic` E SEM `description`/`website` (genérico)

**Nota**: Praias nomeadas geralmente são importantes para turismo, então `name` é incluído como critério.

##### Para NATURAL=CLIFF (penhascos):
**Manter se:**
- Tem `tourism=*` OU `historic=*` (já importante)
- OU tem `wikipedia` OU `wikidata` (referência externa)
- OU tem `description` OU `website` (documentado)
- OU tem `name` (penhasco nomeado - será verificado na importação)

**Excluir se:**
- `natural=cliff` SEM `name` E SEM referências E SEM `tourism`/`historic` E SEM `description`/`website` (genérico)

**Nota**: Penhascos nomeados geralmente são importantes, então `name` é incluído como critério.

##### Para NATURAL (outros - volcano, hot_spring, geyser, cave):
**Manter se:**
- Tem `tourism=*` OU `historic=*` (já importante)
- OU tem `wikipedia` OU `wikidata` (referência)
- OU tem `description` OU `website` (documentado)
- OU tem `name` (nomeado - será verificado na importação)

**Excluir se:**
- `natural=*` SEM `name` E SEM referências E SEM `tourism`/`historic` E SEM `description`/`website` (genérico)

**Nota**: Estas categorias têm poucos itens (volcano: 3, hot_spring: 2), então são menos problemáticas.

**Exemplos:**
- ✅ `natural=volcano` + `name` → MANTER (vulcão nomeado)
- ✅ `natural=hot_spring` + `name` → MANTER (fonte termal nomeada)

##### Para LEISURE=PARK (parques):
**Manter se:**
- Tem `tourism=*` OU `historic=*` (já importante)
- OU tem `wikipedia` OU `wikidata` (referência externa)
- OU tem `description` OU `website` (documentado)
- OU tem `park:type` (tipo específico)
- OU tem `operator` (geralmente público/importante)
- OU tem `name` (nomeado - será verificado na importação)

**Excluir se:**
- `leisure=park` SEM `name` E SEM referências E SEM `tourism`/`historic` E SEM `description`/`website` E SEM `park:type` E SEM `operator` (genérico)

**Nota**: Parques importantes como Villa-Lobos e Ibirapuera geralmente têm `name`, então serão mantidos mesmo sem outros critérios. Na importação, serão verificados no Nominatim e filtrados se não forem encontrados.

##### Para LEISURE (outros - stadium, etc.):
**Manter se:**
- Tem `tourism=*` OU `historic=*` (já importante)
- OU tem `name` (nomeado)
- OU tem `wikipedia` OU `wikidata` (referência)
- OU tem `description` OU `website` (documentado)

**Excluir se:**
- `leisure=*` SEM `name` E SEM referências E SEM `tourism`/`historic` (genérico)

##### Para RAILWAY (removido da lista):
**Nota**: `railway=station` foi removido da lista de categorias.
- Nenhuma estação tem tag `tourism`
- Estações históricas são capturadas por `historic=train_station`
- Isso evita incluir 540 estações sem valor turístico/histórico

##### Para AEROWAY (aeroway=aerodrome):
**Manter se:**
- Tem `name` (aeródromo nomeado)
- OU tem `wikipedia` OU `wikidata` (referência)
- OU tem `iata` OU `icao` (códigos de aeroporto indicam importância)

**Excluir se:**
- `aeroway=aerodrome` SEM `name` E SEM referências E SEM códigos (genérico)

##### Para AMENITY=THEATRE (teatros):
**Manter se:**
- Tem `historic` (teatro histórico)
- OU tem `wikipedia` OU `wikidata` (referência externa - indica importância)
- OU tem `name` (nomeado - será verificado na importação)
- OU tem `description` OU `website` (documentado)

**Excluir se:**
- `amenity=theatre` SEM `historic` E SEM referências E SEM `name` E SEM `description`/`website` (genérico)

## Resumo da Lógica (Simplificada)

```
POI é incluído se:
  (tem tourism OU historic)  // Já importante
  OU
  (tem wikipedia OU wikidata)  // Referência externa
  OU
  (tem description OU website)  // Documentado
  OU
  (tem name)  // Nomeado (será verificado na importação)

E NÃO é excluído se:
  (tem tourism OU historic)  // Mantém independente de acesso
  OU
  (access != no) AND
  (access != residential) AND
  (residential != yes) AND
  (access != private)
  
NOTA: Sempre verificar tourism/historic primeiro. Se tiver, mantém independente de acesso.
```

## Implementação Técnica

### Estratégia: Filtro em Múltiplas Etapas

#### Etapa 1: Filtro por Categorias (já implementado ✅)
```bash
osmium tags-filter \
  --omit-referenced \
  --expressions categories.txt \
  input.osm.pbf \
  -o step1-categories.osm.pbf
```

**categories.txt:**
```
nwr/tourism=*
nwr/historic=*
nwr/natural=*
nwr/leisure=*
nwr/aeroway=aerodrome
nwr/amenity=theatre
```

#### Etapa 2: Remover POIs Privados (novo)
Como osmium não suporta filtro negativo direto, vamos criar filtros positivos para os indicadores de importância.

**Estratégia**: Filtrar mantendo apenas POIs que têm indicadores de importância OU que não são privados.

#### Etapa 3: Filtro por Indicadores de Importância

**Abordagem A: Filtro com múltiplos arquivos e merge**

1. **Filtrar tourism e historic (manter todos)**
```bash
osmium tags-filter step1-categories.osm.pbf \
  nwr/tourism=*,nwr/historic=* \
  -o step3-tourism-historic.osm.pbf
```

2. **Filtrar natural/leisure/railway/aeroway com indicadores**
```bash
# Natural com indicadores
osmium tags-filter step1-categories.osm.pbf \
  nwr/natural=* \
  -o temp-natural.osm.pbf

# Filtrar temp-natural mantendo apenas com:
# - name OU wikipedia OU wikidata OU description OU website
# (precisa script ou múltiplos filtros)
```

**Abordagem B: Pós-processamento (mais simples)**
1. Converter para GeoJSON temporariamente
2. Filtrar programaticamente (Python/Deno)
3. Converter de volta para PBF

**Problema**: Arquivo muito grande (181k features) pode causar problemas de memória.

**Abordagem C: Filtro com expressões combinadas (mais prática)**
Criar múltiplos filtros e fazer merge:

```bash
# 1. Tourism e Historic (todos)
osmium tags-filter step1-categories.osm.pbf \
  nwr/tourism=*,nwr/historic=* \
  -o important-tourism-historic.osm.pbf

# 2. Natural com name
osmium tags-filter step1-categories.osm.pbf \
  nwr/natural=* \
  -o temp-natural.osm.pbf
osmium tags-filter temp-natural.osm.pbf \
  nwr/name \
  -o important-natural-named.osm.pbf

# 3. Natural com wikipedia
osmium tags-filter temp-natural.osm.pbf \
  nwr/wikipedia \
  -o important-natural-wikipedia.osm.pbf

# 4. Natural com wikidata
osmium tags-filter temp-natural.osm.pbf \
  nwr/wikidata \
  -o important-natural-wikidata.osm.pbf

# 5. Natural com description/website
osmium tags-filter temp-natural.osm.pbf \
  nwr/description,nwr/website \
  -o important-natural-documented.osm.pbf

# 6. Merge de todos
osmium merge \
  important-tourism-historic.osm.pbf \
  important-natural-named.osm.pbf \
  important-natural-wikipedia.osm.pbf \
  important-natural-wikidata.osm.pbf \
  important-natural-documented.osm.pbf \
  -o step3-important.osm.pbf
```

**Repetir para leisure, railway, aeroway**

**Abordagem D: Simplificada (recomendada)**
1. Filtrar por categorias (já feito)
2. Remover privados usando script
3. Para natural/leisure genéricos: manter apenas se têm `name` OU referências

## Lógica Final Simplificada (Prática)

### Critérios de Inclusão (OR - pelo menos um):

1. **Tem tourism OU historic** → ✅ MANTER (já importante)
2. **Tem wikipedia OU wikidata** → ✅ MANTER (referência externa)
3. **Tem description OU website** → ✅ MANTER (documentado)
4. **Tem name** → ✅ MANTER (nomeado - será verificado na importação)

**NOTA**: POIs sem nome não são excluídos aqui (serão filtrados na importação via Nominatim)

### Critérios de Exclusão (Sempre verificar tourism/historic primeiro):

**Regra Geral**: Se tem `tourism` OU `historic` → ✅ **MANTER** (independente de acesso)

**Excluir APENAS se (NÃO tem tourism/historic E):**
1. **access=no** → ❌ EXCLUIR (sem acesso público)
2. **access=residential** → ❌ EXCLUIR (acesso residencial)
3. **residential=yes** → ❌ EXCLUIR (área residencial)
4. **access=private** → ❌ EXCLUIR (acesso privado)

**Exemplos:**
- `tourism=attraction` + `access=no` → ✅ MANTER (turístico mesmo sem acesso)
- `historic=castle` + `access=private` → ✅ MANTER (histórico mesmo privado)
- `aeroway=aerodrome` + `access=private` → ❌ EXCLUIR (não é turístico/histórico)
- `natural=tree` + `access=no` → ❌ EXCLUIR (não é turístico/histórico)

### Regras Especiais:

- **natural/leisure/railway/aeroway**: Aplicar critérios de inclusão normalmente
- Se não atender nenhum critério de inclusão → ❌ EXCLUIR

## Exemplos Práticos

### ✅ MANTER:
- `tourism=attraction` → ✅ (tem tourism)
- `historic=monument` → ✅ (tem historic)
- `historic=castle` + `access=private` → ✅ (privado MAS tem historic - visível da rua)
- `natural=peak` + `name="Pico do Jaraguá"` → ✅ (tem name)
- `natural=peak` + `wikipedia` → ✅ (tem referência)
- `leisure=park` + `name` → ✅ (tem name)
- `historic=train_station` + `name` → ✅ (estação histórica)
- `aeroway=aerodrome` + `iata` → ✅ (tem código)

### ❌ EXCLUIR:
- `natural=tree` sem name/referências/description/website → ❌ (genérico)
- `natural=water` sem name/referências/description/website → ❌ (genérico)
- `leisure=park` sem name/referências/description/website → ❌ (genérico)
- `aeroway=aerodrome` + `access=private` SEM tourism/historic → ❌ (privado sem valor turístico)
- `aeroway=aerodrome` + `access=no` SEM tourism/historic → ❌ (sem acesso e não é turístico/histórico)
- Qualquer POI sem tourism/historic + `access=residential` → ❌ (acesso residencial)

### ✅ MANTER (mesmo com restrição de acesso):
- `historic=monument` + `access=no` → ✅ (histórico, mantém)
- `tourism=attraction` + `access=private` → ✅ (turístico, mantém)
- `historic=castle` + `access=residential` → ✅ (histórico, mantém)

## Próximos Passos

1. ✅ Lógica definida (ESTE DOCUMENTO)
2. ⏳ Implementar filtro em etapas
3. ⏳ Testar com arquivo atual
4. ⏳ Validar resultados
5. ⏳ Ajustar critérios se necessário
