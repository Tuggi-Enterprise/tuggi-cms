# Documentação dos Campos de POI - Sistema de Importação OSM

## Visão Geral

Este documento define todos os campos de POI que são importados e processados pelo sistema Tuggi CMS. Esta documentação serve como referência para:

1. **Conversor PBF → GeoJSON**: Garantir que todos os campos necessários sejam preservados na conversão
2. **Desenvolvedores**: Entender quais dados estão disponíveis para cada POI
3. **Geração de Descrições**: Conhecer todos os campos disponíveis para criar descrições ricas

## Estrutura dos Dados

### Fonte dos Dados
- **Arquivo PBF**: `output/tourism.osm.pbf` (dados brutos do OpenStreetMap)
- **Arquivo GeoJSON**: `output/tourism.geojson` (dados convertidos e processados)
- **Banco de Dados**: Schema `homolog.pois` (dados finais armazenados)

### Conversão PBF → GeoJSON
O conversor deve preservar os seguintes campos essenciais:

```bash
# Comando de conversão recomendado
osmium export \
  --output-format=geojson \
  --output=tourism.geojson \
  --overwrite \
  --add-other-tags \
  --add-metadata \
  --id-type=string \
  --id-format=type_id \
  tourism.osm.pbf
```

## Campos Importados (98 campos)

### 1. CAMPOS CORE ESSENCIAIS (20 campos)

| Campo | Tipo | OSM Tag | Descrição | Exemplo |
|-------|------|---------|-----------|---------|
| `name` | TEXT | `name` | Nome do POI | "Museu de Arte" |
| `city` | TEXT | `addr:city` | Cidade | "São Paulo" |
| `state` | TEXT | `addr:state` | Estado | "SP" |
| `country` | TEXT | `addr:country` | País | "Brazil" |
| `category` | TEXT | `tourism`, `amenity`, etc. | Categoria normalizada | "museum" |
| `osm_id` | BIGINT | `@id` | ID do OSM | 123456 |
| `osm_type` | TEXT | `@type` | Tipo do OSM | "node" |
| `place_id` | BIGINT | `place_id` | ID do lugar | 12345 |
| `formatted_address` | TEXT | Nominatim | Endereço formatado | "Rua X, 123" |
| `importance` | DECIMAL | Nominatim | Importância (0-1) | 0.8 |
| `source_file` | TEXT | Sistema | Arquivo de origem | "tourism.geojson" |
| `source_type` | TEXT | Sistema | Tipo de fonte | "osm" |
| `is_complete` | BOOLEAN | Sistema | POI completo | true |
| `has_nominatim_data` | BOOLEAN | Sistema | Tem dados Nominatim | true |
| `processing_status` | TEXT | Sistema | Status do processamento | "completed" |
| `osm_properties` | JSONB | Todos | Propriedades OSM originais | `{...}` |
| `approved` | BOOLEAN | Sistema | Aprovado para exibição | false |
| `osm_geometry` | GEOGRAPHY | `geometry` | Geometria espacial | `POINT(...)` |
| `lat` | DECIMAL | `geometry.coordinates[1]` | Latitude | -23.5505 |
| `lon` | DECIMAL | `geometry.coordinates[0]` | Longitude | -46.6333 |

### 2. CAMPOS DE ENDEREÇO (5 campos)

| Campo | Tipo | OSM Tag | Descrição | Exemplo |
|-------|------|---------|-----------|---------|
| `description` | TEXT | `description` | Descrição do POI | "Museu de arte moderna" |
| `neighborhood` | TEXT | `addr:suburb` | Bairro | "Vila Madalena" |
| `street_name` | TEXT | `addr:street` | Nome da rua | "Rua das Flores" |
| `house_number` | TEXT | `addr:housenumber` | Número da casa | "123" |
| `postal_code` | TEXT | `addr:postcode` | CEP | "01234-567" |

### 3. CAMPOS DE CATEGORIA (3 campos)

| Campo | Tipo | OSM Tag | Descrição | Exemplo |
|-------|------|---------|-----------|---------|
| `primary_category` | TEXT | `tourism`, `amenity` | Categoria principal | "museum" |
| `primary_category_type` | TEXT | Sistema | Tipo da categoria | "osm" |
| `categories` | JSONB | Sistema | Lista de categorias | `["museum", "art"]` |

### 4. CAMPOS DE CONTATO (4 campos)

| Campo | Tipo | OSM Tag | Descrição | Exemplo |
|-------|------|---------|-----------|---------|
| `website` | TEXT | `website` | Site oficial | "https://museu.com" |
| `contact_phone` | TEXT | `phone` | Telefone | "+55 11 1234-5678" |
| `contact_email` | TEXT | `email` | Email | "contato@museu.com" |
| `operator_name` | TEXT | `operator` | Operador | "Prefeitura de SP" |

### 5. CAMPOS DE MARCA (3 campos)

| Campo | Tipo | OSM Tag | Descrição | Exemplo |
|-------|------|---------|-----------|---------|
| `brand` | TEXT | `brand` | Marca | "McDonald's" |
| `brand_wikidata` | TEXT | `brand:wikidata` | ID Wikidata da marca | "Q38076" |
| `brand_wikipedia` | TEXT | `brand:wikipedia` | Link Wikipedia da marca | "pt:McDonald's" |

### 6. CAMPOS DE INTERNET (2 campos)

| Campo | Tipo | OSM Tag | Descrição | Exemplo |
|-------|------|---------|-----------|---------|
| `internet_access` | TEXT | `internet_access` | Acesso à internet | "wlan" |
| `internet_access_fee` | TEXT | `internet_access:fee` | Taxa de internet | "no" |

### 7. CAMPOS DE ACESSIBILIDADE (3 campos)

| Campo | Tipo | OSM Tag | Descrição | Exemplo |
|-------|------|---------|-----------|---------|
| `wheelchair_accessible` | TEXT | `wheelchair` | Acesso para cadeirantes | "yes" |
| `wheelchair_toilets` | TEXT | `toilets:wheelchair` | Banheiros acessíveis | "yes" |
| `accessibility_notes` | TEXT | `accessibility:notes` | Notas de acessibilidade | "Rampa na entrada" |

### 8. CAMPOS FÍSICOS (6 campos)

| Campo | Tipo | OSM Tag | Descrição | Exemplo |
|-------|------|---------|-----------|---------|
| `height_m` | DECIMAL | `height` | Altura em metros | 15.5 |
| `elevation_m` | DECIMAL | `ele` | Elevação em metros | 760.0 |
| `architectural_style` | TEXT | `architectural_style` | Estilo arquitetônico | "baroque" |
| `building_material` | TEXT | `building:material` | Material da construção | "brick" |
| `building_colour` | TEXT | `building:colour` | Cor do edifício | "white" |
| `capacity` | INTEGER | `capacity` | Capacidade | 500 |

### 9. CAMPOS HISTÓRICOS/PATRIMONIAIS (9 campos)

| Campo | Tipo | OSM Tag | Descrição | Exemplo |
|-------|------|---------|-----------|---------|
| `historic_period` | TEXT | `historic:period` | Período histórico | "medieval" |
| `heritage_status` | TEXT | `heritage:status` | Status patrimonial | "listed" |
| `unesco_status` | TEXT | `unesco:status` | Status UNESCO | "world_heritage" |
| `unesco_inscription_date` | TEXT | `unesco:inscription_date` | Data de inscrição UNESCO | "1987" |
| `unesco_reference` | TEXT | `unesco:reference` | Referência UNESCO | "274" |
| `landmark_type` | TEXT | `landmark:type` | Tipo de marco | "monument" |
| `landmark_level` | INTEGER | `landmark:level` | Nível do marco | 3 |
| `architect` | TEXT | `architect` | Arquiteto | "Oscar Niemeyer" |
| `construction_status` | TEXT | `construction:status` | Status da construção | "completed" |
| `start_date` | TEXT | `start_date` | Data de início | "1950" |

### 10. CAMPOS ESPECÍFICOS POR TIPO (9 campos)

| Campo | Tipo | OSM Tag | Descrição | Exemplo |
|-------|------|---------|-----------|---------|
| `museum_type` | TEXT | `museum:type` | Tipo de museu | "art" |
| `museum_collection` | TEXT | `museum:collection` | Coleção do museu | "modern_art" |
| `museum_audience` | TEXT | `museum:audience` | Público-alvo | "adults" |
| `museum_education` | TEXT | `museum:education` | Programas educacionais | "yes" |
| `leisure_type` | TEXT | `leisure:type` | Tipo de lazer | "park" |
| `monument_type` | TEXT | `monument:type` | Tipo de monumento | "statue" |
| `monument_event` | TEXT | `monument:event` | Evento do monumento | "independence" |
| `monument_person` | TEXT | `monument:person` | Pessoa do monumento | "Tiradentes" |
| `natural_water` | TEXT | `natural:water` | Tipo de água natural | "lake" |

### 11. CAMPOS DE INFRAESTRUTURA (3 campos)

| Campo | Tipo | OSM Tag | Descrição | Exemplo |
|-------|------|---------|-----------|---------|
| `parking_capacity` | TEXT | `parking:capacity` | Capacidade de estacionamento | "50" |
| `access_points` | TEXT | `access:points` | Pontos de acesso | "main_entrance" |
| `entrance_fee` | TEXT | `entrance:fee` | Taxa de entrada | "yes" |

### 12. CAMPOS AMBIENTAIS (2 campos)

| Campo | Tipo | OSM Tag | Descrição | Exemplo |
|-------|------|---------|-----------|---------|
| `urban_density` | TEXT | `urban:density` | Densidade urbana | "high" |
| `shade_availability` | TEXT | `shade:availability` | Disponibilidade de sombra | "yes" |

### 13. CAMPOS CULTURAIS (3 campos)

| Campo | Tipo | OSM Tag | Descrição | Exemplo |
|-------|------|---------|-----------|---------|
| `cultural_significance` | TEXT | `cultural:significance` | Significado cultural | "religious" |
| `local_traditions` | TEXT | `local:traditions` | Tradições locais | "festa_junina" |
| `seasonal_attractions` | TEXT | `seasonal:attractions` | Atrações sazonais | "christmas_lights" |

### 14. FLAGS DE TURISMO (11 campos)

| Campo | Tipo | OSM Tag | Descrição | Exemplo |
|-------|------|---------|-----------|---------|
| `is_historic` | BOOLEAN | `historic=yes` | É histórico | true |
| `is_touristic` | BOOLEAN | `tourism=yes` | É turístico | true |
| `has_train` | BOOLEAN | `train=yes` | Tem trem | true |
| `has_ferry` | BOOLEAN | `ferry=yes` | Tem balsa | false |
| `has_bus` | BOOLEAN | `bus=yes` | Tem ônibus | true |
| `has_wheelchair_access` | BOOLEAN | `wheelchair=yes` | Acesso para cadeirantes | true |
| `has_water` | BOOLEAN | `water=yes` | Tem água | false |
| `has_fishing` | BOOLEAN | `fishing=yes` | Tem pesca | false |
| `has_playground` | BOOLEAN | `playground=yes` | Tem playground | true |
| `is_building` | BOOLEAN | `building=yes` | É edifício | true |
| `has_ruins` | BOOLEAN | `ruins=yes` | Tem ruínas | false |

### 15. CAMPOS CRÍTICOS (4 campos)

| Campo | Tipo | OSM Tag | Descrição | Exemplo |
|-------|------|---------|-----------|---------|
| `opening_hours` | TEXT | `opening_hours` | Horário de funcionamento | "Mo-Fr 09:00-18:00" |
| `wikidata` | TEXT | `wikidata` | ID Wikidata | "Q123456" |
| `wikipedia` | TEXT | `wikipedia` | Link Wikipedia | "pt:Museu_de_Arte" |
| `amenity` | TEXT | `amenity` | Tipo de amenidade | "museum" |

### 16. CAMPOS IMPORTANTES (3 campos)

| Campo | Tipo | OSM Tag | Descrição | Exemplo |
|-------|------|---------|-----------|---------|
| `building` | TEXT | `building` | Tipo de edifício | "museum" |
| `artwork_type` | TEXT | `artwork_type` | Tipo de obra de arte | "sculpture" |
| `information` | TEXT | `information` | Tipo de informação | "board" |

### 17. CAMPOS DE ANÁLISE PBF (6 campos)

| Campo | Tipo | OSM Tag | Descrição | Exemplo |
|-------|------|---------|-----------|---------|
| `source` | TEXT | `source` | Fonte dos dados | "survey" |
| `natural_type` | TEXT | `natural` | Tipo natural | "tree" |
| `landuse` | TEXT | `landuse` | Uso do solo | "commercial" |
| `access` | TEXT | `access` | Tipo de acesso | "private" |
| `ref` | TEXT | `ref` | Referência | "123" |
| `type` | TEXT | `type` | Tipo | "multipolygon" |

## Campos Removidos (60+ campos)

Os seguintes campos foram **intencionalmente removidos** para manter a função RPC dentro do limite de 100 parâmetros:

### Campos Obsoletos
- `contact_fax` - Fax (obsoleto)
- `roof_colour` - Cor do telhado (muito específico)
- `importance_level` - Redundante com `importance`

### Campos de Detalhes Específicos
- `sport_facilities` - Instalações esportivas
- `leisure_playground` - Playground de lazer
- `public_transport` - Transporte público (genérico)
- `noise_level` - Nível de ruído
- `air_quality` - Qualidade do ar

### Campos PBF Secundários (47 campos)
- Redes sociais: `contact:facebook`, `contact:instagram`, etc.
- Pagamentos: `payment:credit_cards`, `payment:cash`, etc.
- Capacidade: `rooms`, `air_conditioning`, `smoking`, etc.
- Geográficos: `surface`, `waterway`, `power`, `lanes`, etc.

## Instruções para o Conversor PBF → GeoJSON

### 1. Comando de Conversão
```bash
osmium export \
  --output-format=geojson \
  --output=tourism.geojson \
  --overwrite \
  --add-other-tags \
  --add-metadata \
  --id-type=string \
  --id-format=type_id \
  tourism.osm.pbf
```

### 2. Campos Obrigatórios a Preservar
O conversor **DEVE** preservar todos os campos listados acima, especialmente:

- **ID e Tipo**: `@id` e `@type` (essenciais para UUID)
- **Geometria**: `geometry` (coordenadas)
- **Propriedades**: Todos os campos OSM listados
- **Metadados**: `timestamp`, `version`, `changeset`, `user`, `uid`

### 3. Estrutura GeoJSON Esperada
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "n123456",
      "properties": {
        "@id": "n123456",
        "@type": "node",
        "name": "Museu de Arte",
        "tourism": "museum",
        "addr:city": "São Paulo",
        "addr:state": "SP",
        "website": "https://museu.com",
        "opening_hours": "Mo-Fr 09:00-18:00",
        "wheelchair": "yes",
        "height": "15.5",
        "ele": "760.0",
        // ... todos os outros campos listados acima
      },
      "geometry": {
        "type": "Point",
        "coordinates": [-46.6333, -23.5505]
      }
    }
  ]
}
```

### 4. Validação
Após a conversão, verificar se:
- ✅ Todos os 98 campos estão presentes
- ✅ `@id` e `@type` estão corretos
- ✅ Geometria está no formato correto
- ✅ Propriedades OSM estão preservadas
- ✅ Metadados estão incluídos

## Uso para Geração de Descrições

Esta documentação serve como base para criar descrições ricas de POIs, utilizando todos os campos disponíveis para:

1. **Descrições Contextuais**: Usar campos históricos, culturais e ambientais
2. **Informações Práticas**: Usar campos de contato, horários e acessibilidade
3. **Detalhes Físicos**: Usar campos de altura, material e capacidade
4. **Classificação**: Usar campos de categoria e tipo específico

---

**Última Atualização**: 20 de Dezembro de 2024  
**Versão**: 1.0  
**Sistema**: Tuggi CMS - OSM Importer
