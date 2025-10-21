# 📊 CATEGORIAS OSM ATUALIZADAS - INCLUINDO VIAS E AEROPORTOS

## 🎯 **CATEGORIAS PRINCIPAIS PARA POIs**

### 🏛️ **TURISMO E CULTURA**
- **tourism** - Pontos turísticos
- **historic** - Patrimônio histórico

### 🌿 **NATURAL E AMBIENTE**
- **natural** (selecionar subcategorias)
  - `natural=peak` - Picos/montanhas
  - `natural=water` - Corpos d'água
  - `natural=beach` - Praias
  - `natural=cliff` - Penhascos
  - `natural=cave` - Cavernas

### 🏢 **SERVIÇOS E AMENIDADES**
- **amenity** (selecionar subcategorias)
  - `amenity=place_of_worship` - Igrejas/templos
  - `amenity=hospital` - Hospitais
  - `amenity=school` - Escolas
  - `amenity=restaurant` - Restaurantes
  - `amenity=bank` - Bancos

### 🏃 **LAZER E ESPORTE**
- **leisure** (selecionar subcategorias)
  - `leisure=park` - Parques
  - `leisure=sports_centre` - Centros esportivos
  - `leisure=swimming_pool` - Piscinas

### 🛣️ **VIAS IMPORTANTES (NOVO)**
- **highway** (selecionar apenas vias importantes)
  - `highway=primary` - Vias principais (Avenida Paulista)
  - `highway=secondary` - Vias secundárias importantes
  - `highway=trunk` - Rodovias
  - `highway=motorway` - Autoestradas

### ✈️ **AEROPORTOS (NOVO)**
- **aeroway** (todos os aeroportos)
  - `aeroway=aerodrome` - Aeroportos
  - `aeroway=terminal` - Terminais
  - `aeroway=runway` - Pistas

## 🚀 **COMANDOS ATUALIZADOS**

### **1. POIs Básicos (Turismo + Cultural)**
```bash
osmium tags-filter sudeste-251012.osm.pbf nwr/tourism,nwr/historic -o poi-basic.osm.pbf
```

### **2. POIs + Vias Importantes**
```bash
osmium tags-filter sudeste-251012.osm.pbf \
  nwr/tourism,nwr/historic \
  nwr/highway=primary,nwr/highway=secondary,nwr/highway=trunk \
  -o poi-with-roads.osm.pbf
```

### **3. POIs + Aeroportos**
```bash
osmium tags-filter sudeste-251012.osm.pbf \
  nwr/tourism,nwr/historic \
  nwr/aeroway \
  -o poi-with-airports.osm.pbf
```

### **4. COMBINAÇÃO COMPLETA (RECOMENDADA)**
```bash
osmium tags-filter sudeste-251012.osm.pbf \
  nwr/tourism,nwr/historic \
  nwr/natural=peak,nwr/natural=water,nwr/natural=beach \
  nwr/leisure=park,nwr/leisure=sports_centre \
  nwr/amenity=place_of_worship,nwr/amenity=hospital,nwr/amenity=school \
  nwr/highway=primary,nwr/highway=secondary \
  nwr/aeroway \
  -o poi-complete.osm.pbf
```

## 🎯 **JUSTIFICATIVA PARA INCLUIR VIAS E AEROPORTOS**

### **🛣️ VIAS IMPORTANTES**
- **Avenida Paulista** - Marco cultural de São Paulo
- **Pontos de referência** para navegação
- **Landmarks** importantes da cidade
- **Conectividade** entre POIs

### **✈️ AEROPORTOS**
- **Pontos de entrada** na cidade
- **Landmarks** importantes
- **Serviços** para turistas
- **Conectividade** internacional

## 📋 **PRÓXIMOS PASSOS**

1. **Escolha o nível de inclusão:**
   - **Básico**: Apenas turismo + histórico
   - **Intermediário**: + vias importantes + aeroportos
   - **Completo**: + natural + leisure + amenity selecionados

2. **Execute o comando** correspondente

3. **Teste com nosso plugin:**
   ```bash
   npm run osm:analyze poi-complete.geojson
   npm run osm:preview poi-complete.geojson
   ```

## 🛠️ **TESTE RÁPIDO**

```bash
# Teste com vias importantes
osmium tags-filter sudeste-251012.osm.pbf nwr/highway=primary -o test-roads.osm.pbf
osmium export test-roads.osm.pbf -o test-roads.geojson
npm run osm:preview test-roads.geojson

# Teste com aeroportos
osmium tags-filter sudeste-251012.osm.pbf nwr/aeroway -o test-airports.osm.pbf
osmium export test-airports.osm.pbf -o test-airports.geojson
npm run osm:preview test-airports.geojson
```
