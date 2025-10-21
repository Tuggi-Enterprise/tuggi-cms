# 📊 CATEGORIAS DETALHADAS OSM - SUDESTE BRASIL

## 🎯 **CATEGORIAS PRINCIPAIS E SUBCATEGORIAS**

### 🏛️ **TURISMO (tourism)**
Baseado na análise do arquivo filtrado, temos:

#### **HOSPEDAGEM**
- `tourism=hotel` (5,721 POIs) - Hotéis
- `tourism=guest_house` (837 POIs) - Pousadas
- `tourism=hostel` (637 POIs) - Albergues
- `tourism=camp_site` (634 POIs) - Campings
- `tourism=motel` (582 POIs) - Motéis
- `tourism=chalet` (511 POIs) - Chalés

#### **ATRAÇÕES TURÍSTICAS**
- `tourism=attraction` (2,832 POIs) - Atrações gerais
- `tourism=museum` (1,241 POIs) - Museus
- `tourism=artwork` (1,541 POIs) - Obras de arte
- `tourism=viewpoint` (1,111 POIs) - Mirantes
- `tourism=information` (1,197 POIs) - Pontos de informação

#### **OUTROS TURISMO**
- `tourism=theme_park` - Parques temáticos
- `tourism=zoo` - Zoológicos
- `tourism=aquarium` - Aquários
- `tourism=gallery` - Galerias de arte
- `tourism=picnic_site` - Áreas de piquenique

### 🏛️ **HISTÓRICO (historic)**
- `historic=monument` - Monumentos
- `historic=castle` - Castelos
- `historic=church` - Igrejas históricas
- `historic=memorial` - Memoriais
- `historic=ruins` - Ruínas
- `historic=archaeological_site` - Sítios arqueológicos
- `historic=fort` - Fortes
- `historic=tomb` - Túmulos
- `historic=wayside_shrine` - Capelas

### 🌿 **NATURAL (natural)**
- `natural=peak` - Picos/montanhas
- `natural=water` - Corpos d'água
- `natural=wood` - Florestas
- `natural=beach` - Praias
- `natural=cliff` - Penhascos
- `natural=cave` - Cavernas
- `natural=spring` - Nascentes
- `natural=tree` - Árvores notáveis
- `natural=waterfall` - Cachoeiras
- `natural=volcano` - Vulcões
- `natural=geyser` - Gêiseres
- `natural=hot_spring` - Fontes termais

### 🏢 **AMENIDADES (amenity)**
#### **SAÚDE**
- `amenity=hospital` - Hospitais
- `amenity=clinic` - Clínicas
- `amenity=pharmacy` - Farmácias
- `amenity=doctors` - Consultórios médicos

#### **EDUCAÇÃO**
- `amenity=school` - Escolas
- `amenity=university` - Universidades
- `amenity=college` - Faculdades
- `amenity=kindergarten` - Jardins de infância

#### **RELIGIÃO**
- `amenity=place_of_worship` - Locais de culto
- `amenity=church` - Igrejas
- `amenity=mosque` - Mesquitas
- `amenity=temple` - Templos

#### **SERVIÇOS**
- `amenity=bank` - Bancos
- `amenity=atm` - Caixas eletrônicos
- `amenity=post_office` - Correios
- `amenity=police` - Polícia
- `amenity=fire_station` - Bombeiros

#### **ALIMENTAÇÃO**
- `amenity=restaurant` - Restaurantes
- `amenity=fast_food` - Fast food
- `amenity=cafe` - Cafés
- `amenity=bar` - Bares
- `amenity=pub` - Pubs

### 🏃 **LAZER (leisure)**
- `leisure=park` - Parques
- `leisure=playground` - Parquinhos
- `leisure=sports_centre` - Centros esportivos
- `leisure=swimming_pool` - Piscinas
- `leisure=golf_course` - Campos de golfe
- `leisure=marina` - Marinas
- `leisure=stadium` - Estádios
- `leisure=track` - Pistas de corrida
- `leisure=pitch` - Campos de futebol
- `leisure=water_park` - Parques aquáticos

### 🛍️ **COMÉRCIO (shop)**
- `shop=supermarket` - Supermercados
- `shop=bakery` - Padarias
- `shop=clothes` - Lojas de roupas
- `shop=electronics` - Eletrônicos
- `shop=bookshop` - Livrarias
- `shop=florist` - Floristas
- `shop=gift` - Lojas de presentes
- `shop=jewelry` - Joalherias
- `shop=shoes` - Sapatarias
- `shop=toys` - Brinquedos

## 🎯 **RECOMENDAÇÕES DE FILTRO**

### ✅ **CATEGORIAS RECOMENDADAS PARA INCLUIR**

#### **TURISMO COMPLETO**
```bash
osmium tags-filter sudeste-251012.osm.pbf nwr/tourism -o tourism-complete.osm.pbf
```

#### **CULTURAL (Turismo + Histórico)**
```bash
osmium tags-filter sudeste-251012.osm.pbf nwr/tourism,nwr/historic -o cultural.osm.pbf
```

#### **NATURAL SELECIONADO**
```bash
osmium tags-filter sudeste-251012.osm.pbf nwr/natural=peak,nwr/natural=water,nwr/natural=beach,nwr/natural=cliff,nwr/natural=cave -o natural-selected.osm.pbf
```

#### **LAZER SELECIONADO**
```bash
osmium tags-filter sudeste-251012.osm.pbf nwr/leisure=park,nwr/leisure=sports_centre,nwr/leisure=swimming_pool -o leisure-selected.osm.pbf
```

#### **AMENIDADES SELECIONADAS**
```bash
osmium tags-filter sudeste-251012.osm.pbf nwr/amenity=place_of_worship,nwr/amenity=hospital,nwr/amenity=school,nwr/amenity=restaurant -o amenities-selected.osm.pbf
```

### 🔄 **COMBINAÇÃO COMPLETA RECOMENDADA**
```bash
# Extrair POIs de interesse turístico e cultural
osmium tags-filter sudeste-251012.osm.pbf \
  nwr/tourism \
  nwr/historic \
  nwr/natural=peak,nwr/natural=water,nwr/natural=beach,nwr/natural=cliff,nwr/natural=cave \
  nwr/leisure=park,nwr/leisure=sports_centre,nwr/leisure=swimming_pool \
  nwr/amenity=place_of_worship,nwr/amenity=hospital,nwr/amenity=school \
  -o poi-complete.osm.pbf
```

### ❌ **CATEGORIAS PARA EXCLUIR**
- `highway` - Vias e estradas
- `building` - Edifícios residenciais
- `power` - Infraestrutura elétrica
- `waterway` - Cursos d'água
- `landuse` - Uso do solo genérico
- `addr:*` - Endereços
- `source` - Metadados

## 📋 **PRÓXIMOS PASSOS**

1. **Escolha as categorias** que deseja incluir
2. **Execute o comando osmium** correspondente
3. **Converta para GeoJSON** se necessário
4. **Use nosso plugin** para análise e filtros finais
5. **Configure filtros geográficos** por estado/cidade

## 🛠️ **COMANDOS PRONTOS PARA USO**

```bash
# 1. Turismo completo
osmium tags-filter sudeste-251012.osm.pbf nwr/tourism -o tourism.osm.pbf
osmium export tourism.osm.pbf -o tourism.geojson

# 2. Cultural (turismo + histórico)
osmium tags-filter sudeste-251012.osm.pbf nwr/tourism,nwr/historic -o cultural.osm.pbf
osmium export cultural.osm.pbf -o cultural.geojson

# 3. Natural selecionado
osmium tags-filter sudeste-251012.osm.pbf nwr/natural=peak,nwr/natural=water,nwr/natural=beach -o natural.osm.pbf
osmium export natural.osm.pbf -o natural.geojson

# 4. Análise com nosso plugin
npm run osm:analyze tourism.geojson
npm run osm:preview cultural.geojson
```
