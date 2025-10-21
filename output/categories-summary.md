# 📊 CATEGORIAS OSM DISPONÍVEIS - SUDESTE BRASIL

## 🎯 **CATEGORIAS PRINCIPAIS PARA POIs**

### 🏛️ **TURISMO E CULTURA**
- **tourism** (177,455 POIs) - Pontos turísticos
  - tourism=hotel, tourism=attraction, tourism=museum, tourism=artwork
  - tourism=viewpoint, tourism=information, tourism=guest_house
  - tourism=hostel, tourism=camp_site, tourism=motel, tourism=chalet

### 🏛️ **HISTÓRICO E PATRIMÔNIO**
- **historic** (menor quantidade) - Patrimônio histórico
  - historic=monument, historic=castle, historic=church
  - historic=memorial, historic=ruins, historic=archaeological_site

### 🌿 **NATURAL E AMBIENTE**
- **natural** (775,160 POIs) - Recursos naturais
  - natural=peak, natural=water, natural=wood, natural=beach
  - natural=cliff, natural=cave, natural=spring, natural=tree

### 🏢 **SERVIÇOS E AMENIDADES**
- **amenity** (177,455 POIs) - Serviços urbanos
  - amenity=restaurant, amenity=hospital, amenity=school
  - amenity=place_of_worship, amenity=bank, amenity=pharmacy

### 🛍️ **COMÉRCIO**
- **shop** (63,027 POIs) - Estabelecimentos comerciais
  - shop=supermarket, shop=bakery, shop=clothes, shop=electronics

### 🏃 **LAZER E ESPORTE**
- **leisure** (141,461 POIs) - Áreas de lazer
  - leisure=park, leisure=playground, leisure=sports_centre
  - leisure=swimming_pool, leisure=golf_course

### 🏗️ **CONSTRUÇÕES**
- **building** (3,879,814 POIs) - Edifícios
  - building=house, building=apartments, building=commercial
  - building=industrial, building=church, building=hospital

### 🛣️ **INFRAESTRUTURA**
- **highway** (3,045,995 POIs) - Vias e estradas
  - highway=primary, highway=secondary, highway=residential
  - highway=footway, highway=cycleway, highway=path

### 🚊 **TRANSPORTE**
- **railway** (27,958 POIs) - Ferrovias
- **public_transport** (86,692 POIs) - Transporte público
- **aeroway** (menor quantidade) - Aeroportos e aviação

### ⚡ **ENERGIA E UTILIDADES**
- **power** (427,147 POIs) - Infraestrutura elétrica
- **man_made** (75,290 POIs) - Estruturas artificiais

### 🌊 **ÁGUA E HIDROGRAFIA**
- **waterway** (673,935 POIs) - Cursos d'água
- **water** (54,185 POIs) - Corpos d'água

### 🏞️ **USO DO SOLO**
- **landuse** (401,802 POIs) - Uso do solo
  - landuse=residential, landuse=commercial, landuse=industrial
  - landuse=forest, landuse=farmland, landuse=recreation_ground

## 🎯 **RECOMENDAÇÕES PARA FILTRO**

### ✅ **CATEGORIAS RECOMENDADAS (POIs de Interesse)**
1. **tourism** - Pontos turísticos
2. **historic** - Patrimônio histórico
3. **natural** - Recursos naturais (selecionar subcategorias)
4. **leisure** - Áreas de lazer
5. **amenity** - Serviços importantes (hospital, escola, etc.)

### ❌ **CATEGORIAS PARA EXCLUIR (Infraestrutura)**
1. **highway** - Vias e estradas
2. **building** - Edifícios residenciais
3. **power** - Infraestrutura elétrica
4. **waterway** - Cursos d'água
5. **landuse** - Uso do solo genérico

### 🔍 **SUBCATEGORIAS ESPECÍFICAS PARA CONSIDERAR**

#### **NATURAL (selecionar apenas algumas)**
- natural=peak (picos/montanhas)
- natural=water (corpos d'água)
- natural=beach (praias)
- natural=cliff (penhascos)
- natural=cave (cavernas)

#### **AMENITY (selecionar apenas algumas)**
- amenity=place_of_worship (igrejas/templos)
- amenity=hospital (hospitais)
- amenity=school (escolas)
- amenity=restaurant (restaurantes)

#### **LEISURE (selecionar apenas algumas)**
- leisure=park (parques)
- leisure=playground (parquinhos)
- leisure=sports_centre (centros esportivos)

## 📋 **PRÓXIMOS PASSOS**

1. **Escolha as categorias principais** que deseja incluir
2. **Defina subcategorias específicas** para cada categoria
3. **Configure filtros geográficos** (estados/cidades)
4. **Execute o filtro** usando o plugin

## 🛠️ **COMANDOS PARA TESTE**

```bash
# Extrair apenas turismo
osmium tags-filter sudeste-251012.osm.pbf nwr/tourism -o tourism.osm.pbf

# Extrair turismo + histórico
osmium tags-filter sudeste-251012.osm.pbf nwr/tourism,nwr/historic -o cultural.osm.pbf

# Extrair natural (selecionar subcategorias)
osmium tags-filter sudeste-251012.osm.pbf nwr/natural=peak,nwr/natural=water,nwr/natural=beach -o natural-selected.osm.pbf

# Combinar múltiplas categorias
osmium tags-filter sudeste-251012.osm.pbf nwr/tourism,nwr/historic,nwr/leisure=park -o poi-combined.osm.pbf
```
