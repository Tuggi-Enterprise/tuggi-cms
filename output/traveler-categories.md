# 🧳 CATEGORIAS PARA VIAJANTES - OSM SUDESTE BRASIL

## 🎯 **CATEGORIAS ESSENCIAIS PARA VIAJANTES**

### 🏨 **HOSPEDAGEM E ALOJAMENTO**
- **tourism=hotel** - Hotéis
- **tourism=guest_house** - Pousadas
- **tourism=hostel** - Albergues
- **tourism=camp_site** - Campings
- **tourism=motel** - Motéis
- **tourism=chalet** - Chalés
- **tourism=apartment** - Apartamentos turísticos

### 🍽️ **ALIMENTAÇÃO E GASTRONOMIA**
- **amenity=restaurant** - Restaurantes
- **amenity=cafe** - Cafés
- **amenity=bar** - Bares
- **amenity=pub** - Pubs
- **amenity=fast_food** - Fast food
- **amenity=food_court** - Praças de alimentação

### 🏛️ **CULTURA E TURISMO**
- **tourism=museum** - Museus
- **tourism=artwork** - Obras de arte
- **tourism=attraction** - Atrações turísticas
- **tourism=viewpoint** - Mirantes
- **tourism=information** - Pontos de informação turística
- **tourism=theme_park** - Parques temáticos
- **tourism=zoo** - Zoológicos
- **tourism=aquarium** - Aquários
- **tourism=gallery** - Galerias de arte

### 🏛️ **PATRIMÔNIO HISTÓRICO**
- **historic=monument** - Monumentos
- **historic=castle** - Castelos
- **historic=church** - Igrejas históricas
- **historic=memorial** - Memoriais
- **historic=ruins** - Ruínas
- **historic=archaeological_site** - Sítios arqueológicos

### 🌿 **NATUREZA E PAISAGENS**
- **natural=peak** - Picos/montanhas
- **natural=water** - Lagos, rios, cachoeiras
- **natural=beach** - Praias
- **natural=cliff** - Penhascos
- **natural=cave** - Cavernas
- **natural=waterfall** - Cachoeiras
- **natural=hot_spring** - Fontes termais

### 🏃 **LAZER E ENTRETENIMENTO**
- **leisure=park** - Parques
- **leisure=playground** - Parquinhos
- **leisure=sports_centre** - Centros esportivos
- **leisure=swimming_pool** - Piscinas
- **leisure=golf_course** - Campos de golfe
- **leisure=marina** - Marinas
- **leisure=stadium** - Estádios
- **leisure=water_park** - Parques aquáticos
- **leisure=beach_resort** - Resorts de praia

### 🛍️ **COMPRAS E COMÉRCIO**
- **shop=supermarket** - Supermercados
- **shop=convenience** - Lojas de conveniência
- **shop=clothes** - Lojas de roupas
- **shop=souvenir** - Lojas de souvenirs
- **shop=gift** - Lojas de presentes
- **shop=jewelry** - Joalherias
- **shop=art** - Galerias de arte
- **shop=antiques** - Antiquários
- **shop=craft** - Artesanato

### 🚗 **TRANSPORTE E MOBILIDADE**
- **aeroway=aerodrome** - Aeroportos
- **railway=station** - Estações de trem
- **public_transport=station** - Estações de transporte público
- **amenity=car_rental** - Locadoras de carro
- **amenity=taxi** - Pontos de táxi
- **amenity=bicycle_rental** - Aluguel de bicicletas

### 🏥 **SERVIÇOS ESSENCIAIS**
- **amenity=hospital** - Hospitais
- **amenity=pharmacy** - Farmácias
- **amenity=bank** - Bancos
- **amenity=atm** - Caixas eletrônicos
- **amenity=post_office** - Correios
- **amenity=police** - Polícia
- **amenity=toilets** - Banheiros públicos

### 🏛️ **RELIGIÃO E ESPIRITUALIDADE**
- **amenity=place_of_worship** - Igrejas, templos, mesquitas
- **religion=christian** - Igrejas cristãs
- **religion=catholic** - Igrejas católicas
- **religion=protestant** - Igrejas protestantes

### 🎓 **EDUCAÇÃO E CULTURA**
- **amenity=school** - Escolas
- **amenity=university** - Universidades
- **amenity=library** - Bibliotecas
- **amenity=theatre** - Teatros
- **amenity=cinema** - Cinemas

### 🏢 **SERVIÇOS TURÍSTICOS**
- **tourism=information** - Centros de informação turística
- **tourism=office** - Escritórios de turismo
- **tourism=travel_agency** - Agências de viagem
- **tourism=guide** - Guias turísticos

## 🎯 **COMANDO COMPLETO PARA VIAJANTES**

```bash
osmium tags-filter sudeste-251012.osm.pbf \
  # Hospedagem
  nwr/tourism=hotel,nwr/tourism=guest_house,nwr/tourism=hostel,nwr/tourism=camp_site,nwr/tourism=motel \
  # Alimentação
  nwr/amenity=restaurant,nwr/amenity=cafe,nwr/amenity=bar,nwr/amenity=pub \
  # Cultura e Turismo
  nwr/tourism=museum,nwr/tourism=artwork,nwr/tourism=attraction,nwr/tourism=viewpoint,nwr/tourism=information \
  # Histórico
  nwr/historic \
  # Natureza
  nwr/natural=peak,nwr/natural=water,nwr/natural=beach,nwr/natural=cliff,nwr/natural=cave \
  # Lazer
  nwr/leisure=park,nwr/leisure=sports_centre,nwr/leisure=swimming_pool,nwr/leisure=stadium \
  # Compras
  nwr/shop=supermarket,nwr/shop=convenience,nwr/shop=clothes,nwr/shop=souvenir \
  # Transporte
  nwr/aeroway,nwr/railway=station,nwr/public_transport=station \
  # Serviços
  nwr/amenity=hospital,nwr/amenity=pharmacy,nwr/amenity=bank,nwr/amenity=atm \
  # Religião
  nwr/amenity=place_of_worship \
  # Cultura
  nwr/amenity=theatre,nwr/amenity=cinema,nwr/amenity=library \
  -o traveler-complete.osm.pbf
```

## 🚀 **VERSÕES SIMPLIFICADAS**

### **🎯 ESSENCIAL PARA VIAJANTES**
```bash
osmium tags-filter sudeste-251012.osm.pbf \
  nwr/tourism \
  nwr/historic \
  nwr/amenity=restaurant,nwr/amenity=cafe,nwr/amenity=bar \
  nwr/amenity=hospital,nwr/amenity=pharmacy,nwr/amenity=bank \
  nwr/aeroway \
  -o traveler-essential.osm.pbf
```

### **🎯 CULTURAL E TURÍSTICO**
```bash
osmium tags-filter sudeste-251012.osm.pbf \
  nwr/tourism \
  nwr/historic \
  nwr/natural=peak,nwr/natural=water,nwr/natural=beach \
  nwr/leisure=park,nwr/leisure=sports_centre \
  nwr/amenity=theatre,nwr/amenity=cinema \
  -o traveler-cultural.osm.pbf
```

### **🎯 GASTRONOMIA E COMPRAS**
```bash
osmium tags-filter sudeste-251012.osm.pbf \
  nwr/amenity=restaurant,nwr/amenity=cafe,nwr/amenity=bar \
  nwr/shop=supermarket,nwr/shop=clothes,nwr/shop=souvenir \
  nwr/tourism=attraction \
  -o traveler-gastronomy.osm.pbf
```

## 📋 **PRÓXIMOS PASSOS**

1. **Escolha o foco:**
   - **Essencial**: Hospedagem + alimentação + serviços básicos
   - **Cultural**: Turismo + histórico + natureza + lazer
   - **Completo**: Tudo junto

2. **Execute o comando** correspondente

3. **Teste com nosso plugin:**
   ```bash
   npm run osm:analyze traveler-complete.geojson
   npm run osm:preview traveler-essential.geojson
   ```

## 🎯 **QUAL FOCO VOCÊ QUER TESTAR?**

1. **Essencial** - O básico para viajantes
2. **Cultural** - Foco em turismo e cultura  
3. **Gastronomia** - Foco em alimentação e compras
4. **Completo** - Tudo junto
