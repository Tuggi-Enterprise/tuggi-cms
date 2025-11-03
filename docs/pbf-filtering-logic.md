# Lógica de Filtragem PBF - POIs Turísticos e Históricos

## Objetivo
Criar um arquivo PBF filtrado contendo apenas:
1. Itens de interesse turístico
2. Itens com valor histórico
3. Itens que NÃO sejam privados

## Problemas Identificados
- **Ruas**: Algumas sem valor passaram, mas Av Paulista deveria estar
- **Pontes**: Algumas sem valor passaram, mas Viaduto do Chá deveria estar
- **Picos**: Vários passaram, mas Pico do Jaraguá deveria passar

## Análise dos Dados

### Estatísticas do Arquivo Filtrado Atual (181.322 features)
- **com_tourism**: 4.038 (2.2%)
- **com_historic**: 2.591 (1.4%)
- **com_natural**: 173.690 (95.8%)
- **com_wikipedia**: 401 (0.2%)
- **com_wikidata**: 869 (0.5%)
- **com_name**: 6.598 (3.6%)
- **com_access_private**: 14 (0.0%)
- **com_multiplas_tags** (2+ tags importantes): 1.364 (0.8%)

### Casos de Estudo
1. **Viaduto do Chá** ✅ (está no arquivo filtrado)
   - `tourism=attraction`
   - `historic=bridge`
   - `wikipedia` + `wikidata`
   - **Conclusão**: Tem tags de turismo E histórico E referências externas

2. **Pico do Jaraguá** ✅ (está no arquivo filtrado)
   - `wikipedia` + `wikidata`
   - **Conclusão**: Tem referências externas (indicam importância)

3. **Av Paulista** ❌ (não está no arquivo filtrado)
   - Provavelmente tem apenas `highway=primary/secondary`
   - Não tem `tourism` ou `historic`
   - **Problema**: Como identificar ruas importantes sem tags de turismo?

## Lógica Proposta

### Regra Principal: POI é considerado importante se:

1. **Tem categoria de interesse** (já filtrado):
   - `tourism=*` OU
   - `historic=*` OU
   - `natural=*` OU
   - `leisure=*` OU
   - `railway=station` OU
   - `aeroway=aerodrome`

2. **E NÃO é privado**:
   - `access != private`
   - `access != no`
   - `access != residential`
   - `residential != yes`

3. **E atende pelo menos UM critério de importância**:
   - **a) Tem referência externa**: `wikipedia` OU `wikidata`
   - **b) É nomeado**: `name` existe
   - **c) Tem tags de turismo/histórico**: `tourism=*` OU `historic=*` (já incluído)
   - **d) É highway/bridge/peak importante**: (ver regras específicas abaixo)

### Regras Especiais para Ruas/Pontes/Picos

#### Para HIGHWAY (ruas):
POI é importante se:
- `highway=*` + `name` existe + (`wikipedia` OU `wikidata` OU `tourism` OU `historic`)
- OU `highway=*` + `name` existe + `description` (POI descrito)
- OU `highway=*` + `tourism=*` (já incluído)
- OU `highway=*` + `historic=*` (já incluído)

**Excluir**: `highway=*` SEM `name` (ruas genéricas)

#### Para BRIDGE (pontes):
POI é importante se:
- `bridge=yes` + `name` existe + (`wikipedia` OU `wikidata` OU `tourism` OU `historic`)
- OU `bridge=yes` + `historic=bridge` (já incluído)
- OU `bridge=yes` + `tourism=*` (já incluído)

**Excluir**: `bridge=yes` SEM `name` (pontes genéricas)

#### Para PEAK (picos):
POI é importante se:
- `natural=peak` + (`name` OU `wikipedia` OU `wikidata` OU `tourism` OU `historic`)
- OU `natural=peak` + `ele` (altitude) > valor mínimo (ex: 500m)

**Excluir**: `natural=peak` SEM `name` E SEM referências (picos genéricos)

## Estratégia de Filtragem em Etapas

### Etapa 1: Filtro Inicial por Categorias
Filtrar por todas as categorias esperadas:
- `tourism=*`
- `historic=*`
- `natural=*`
- `leisure=*`
- `railway=station`
- `aeroway=aerodrome`

**Resultado**: Arquivo com todas as categorias de interesse

### Etapa 2: Remover POIs Privados
Excluir objetos com:
- `access=private`
- `access=no`
- `access=residential`
- `residential=yes`

**Resultado**: Arquivo sem POIs privados

### Etapa 3: Filtrar POIs Importantes (refino)

#### 3.1. Manter POIs com tags de turismo/histórico
- Manter todos com `tourism=*`
- Manter todos com `historic=*`
- (Estes já são importantes por definição)

#### 3.2. Manter POIs com referências
- Manter todos com `wikipedia`
- Manter todos com `wikidata`

#### 3.3. Manter POIs nomeados
- Manter todos com `name` (POIs nomeados são geralmente importantes)

#### 3.4. Filtrar highway/bridge/peak genéricos
- **Excluir**: `highway=*` SEM `name` E SEM referências
- **Excluir**: `bridge=yes` SEM `name` E SEM referências
- **Excluir**: `natural=peak` SEM `name` E SEM referências E SEM `tourism`/`historic`

#### 3.5. Manter natural importante
- Manter `natural=*` que tenham `name` OU referências OU `tourism`/`historic`
- (Árvores e elementos naturais nomeados/referenciados são importantes)

### Etapa 4: Validação Final
Verificar:
- Total de POIs removidos
- POIs específicos (Av Paulista, Viaduto do Chá, Pico do Jaraguá) estão incluídos?
- POIs privados foram removidos?

## Implementação Sugerida

### Opção A: Filtragem em Múltiplas Etapas (Recomendado)
1. Filtro inicial por categorias (já feito)
2. Remover POIs privados
3. Filtro por importância (usando osmium tags-filter com expressões negativas)

### Opção B: Filtragem com Expressões Complexas
Usar `osmium tags-filter` com expressões que combinem:
- Categorias esperadas
- E NÃO access=private/no/residential
- E (name OU wikipedia OU wikidata OU tourism OU historic)

### Opção C: Pós-processamento
1. Filtrar por categorias (já feito)
2. Converter para GeoJSON temporariamente
3. Filtrar programaticamente (Python/Deno)
4. Converter de volta para PBF

**Não recomendado**: Arquivo muito grande (181k features) pode causar problemas de memória

## Tags OSM Relevantes

### Tags de Categoria (já filtradas):
- `tourism=*`
- `historic=*`
- `natural=*`
- `leisure=*`
- `railway=station`
- `aeroway=aerodrome`

### Tags de Acesso/Privacidade:
- `access=private` ❌
- `access=no` ❌
- `access=residential` ❌
- `residential=yes` ❌

### Tags de Importância:
- `name` ✅
- `wikipedia` ✅
- `wikidata` ✅
- `description` ✅
- `website` ✅
- `tourism=*` ✅
- `historic=*` ✅

### Tags Especiais:
- `highway=*` (ruas - precisa de critério especial)
- `bridge=yes` (pontes - precisa de critério especial)
- `natural=peak` (picos - precisa de critério especial)

## Decisões Pendentes

1. **Av Paulista**: Como incluí-la se não tem tags de turismo/histórico?
   - Opção: Adicionar regra especial para `highway=primary/secondary` com `name` + `wikipedia`/`wikidata`
   - Opção: Manter apenas ruas com `tourism` ou `historic`

2. **Picos genéricos**: Quantos metros de altitude mínimo?
   - Sugestão: 500m ou picos com `name`/referências

3. **Árvores**: Muitas no arquivo (natural=tree)
   - Manter apenas com `name` OU referências OU `tourism`/`historic`?

4. **Prioridade**: Precisão vs Cobertura
   - Precisão: Excluir mais (menos falsos positivos)
   - Cobertura: Incluir mais (menos falsos negativos)

## Próximos Passos

1. ✅ Análise dos dados (FEITO)
2. ⏳ Definir critérios finais (ESTE DOCUMENTO)
3. ⏳ Implementar filtragem
4. ⏳ Validar resultados
5. ⏳ Ajustar critérios se necessário

