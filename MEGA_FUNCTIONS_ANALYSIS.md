# 🔍 **ANÁLISE DE FUNÇÕES - SISTEMA MEGA-UNIFICADO**

## **🎯 FUNÇÕES ESSENCIAIS PARA MEGA-UNIFIED**

### **1. 🚀 Core Mega-Unified System:**
- `getMegaUnifiedPOIData()` - Função principal de coleta
- `buildMegaUnifiedQuery()` - Construção da query unificada
- `processMegaUnifiedResults()` - Processamento dos resultados
- `separateElementsByType()` - Separação de elementos OSM
- `recalculateForNewPOI()` - Recálculo para POIs próximos

### **2. 🔄 Processadores de Dados Mega:**
- `processBoundaryDataMega()` - Processa boundaries
- `processBuildingDataMega()` - Processa buildings
- `processStreetDataMega()` - Processa streets
- `processElevationDataMega()` - Processa elevation

### **3. 🛠️ Helper Functions Mega:**
- `processPOIHeightMega()` - Altura do POI
- `processRegionalHeightsMega()` - Análise regional
- `calculateUrbanDensityMega()` - Densidade urbana
- `processStreetElementMega()` - Processamento de ruas
- `calculateBuildingCenterMega()` - Centro de buildings
- `extractBuildingHeightMega()` - Extração de altura
- `categorizeHeightMega()` - Categorização de altura
- `findClosestElementMega()` - Elemento mais próximo
- `calculateLandmarkInfo()` - Info de landmark
- `processBoundaryElement()` - Processamento de boundary

### **4. 🎯 Geração de Trigger Points Mega:**
- `generateTriggerPointsFromMegaData()` - Orquestrador principal
- `generateTriggersFromMegaStreets()` - Geração a partir de streets
- `findStrategicPointsOnStreet()` - Pontos estratégicos (OTIMIZADA)
- `checkVisibilityToPOI()` - Verificação de visibilidade (OTIMIZADA)
- `checkLegacyBuildingObstructions()` - Obstruções (OTIMIZADA)

### **5. 🧮 Utility Functions (Usadas por Mega):**
- `calculateDistance()` - Cálculo de distância
- `calculatePolygonArea()` - Área de polígono
- `calculatePolygonCenter()` - Centro de polígono
- `isPointInPolygon()` - Ponto em polígono
- `calculateDistanceToPolygon()` - Distância para polígono
- `lineIntersectsPolygon()` - Interseção linha-polígono
- `createBufferAroundPolygon()` - Buffer ao redor de polígono
- `findClosestPointOnStreet()` - Ponto mais próximo na rua
- `calculateBearing()` - Cálculo de bearing
- `isInBearingRange()` - Verificação de bearing
- `removeDuplicatePoints()` - Remoção de duplicatas

---

## **⚠️ FUNÇÕES LEGACY (CANDIDATAS À REMOÇÃO)**

### **1. 🏚️ Legacy Boundary Detection:**
- `searchOSMByName()` - Busca por nome (substituída por mega-query)
- `searchOSMByCoordinates()` - Busca por coordenadas
- `searchOSMNearbyFeatures()` - Features próximas
- `calculateFeatureRelevance()` - Relevância de features

### **2. 🏚️ Legacy Data Collection:**
- `detectPOIHeight()` - Altura do POI (substituída por mega)
- `detectUrbanDensity()` - Densidade urbana (substituída por mega)
- `detectRelativeElevation()` - Elevação relativa (substituída por mega)
- `getRegionalHeightAverage()` - Altura regional (substituída por mega)
- `searchNearbyBuildingHeights()` - Heights próximas
- `getRealBuildingHeight()` - Altura real de building

### **3. 🏚️ Legacy Street Processing:**
- `findNearbyStreetsForTriggers()` - Streets próximas (substituída por mega)
- `processOverpassStreetData()` - Processamento de streets
- `findStrategicPointsOnStreetLegacy()` - Versão legacy
- `generateStreetBasedTriggerPoints()` - Geração legacy
- `generateTriggersOnStreets()` - Geração legacy

### **4. 🏚️ Legacy Boundary Functions:**
- `generateOptimalTriggerPoints()` - Fallback (manter como fallback)
- `generateBoundaryBasedTriggerPoints()` - Boundary-based
- `createEstimatedBoundary()` - Boundary estimada (manter como fallback)

### **5. 🏚️ Legacy Utility Functions:**
- `queryOverpassAPI()` - Query individual (substituída por mega)
- `buildOverpassQuery()` - Build query individual
- `getOpenElevationAPI()` - API de elevação
- `getCityBaseElevation()` - Elevação da cidade
- `calculateHeightBasedRange()` - Range baseado em altura

---

## **📋 PLANO DE REFATORAÇÃO**

### **✅ MANTER NO INDEX.TS (Sistema Mega + Essenciais):**
1. **Mega-Unified Core System** (funções principais)
2. **Utility Functions** (usadas por ambos)
3. **Optimized Functions** (checkVisibilityToPOI, etc.)
4. **Essential Fallbacks** (generateOptimalTriggerPoints, createEstimatedBoundary)

### **📦 MOVER PARA `legacy-functions.ts`:**
1. **Legacy Data Collection** (detectPOIHeight, detectUrbanDensity, etc.)
2. **Legacy Street Processing** (findNearbyStreetsForTriggers, etc.)
3. **Legacy Boundary Detection** (searchOSMByName, etc.)
4. **Legacy API Functions** (queryOverpassAPI, etc.)

### **🎯 BENEFÍCIOS ESPERADOS:**
- **Redução ~40%** no tamanho do index.ts
- **Manutenção simplificada** - foco apenas no sistema mega
- **Código mais limpo** - separação clara de responsabilidades
- **Performance** - menos código carregado
- **Fallback preservado** - funções críticas mantidas para emergência
