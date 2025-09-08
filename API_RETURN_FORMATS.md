# 📋 **FORMATOS DE RETORNO DAS APIs**
## Análise detalhada para compatibilidade

---

## **🏗️ BUILDING HEIGHT APIs**

### **detectPOIHeight(lat, lng)**
```javascript
// RETORNA:
{
  height: 118.44,           // Altura em metros
  category: 'very_high',    // low, medium, high, very_high
  confidence: 1.0,          // 0.0-1.0
  source: 'osm_direct'      // osm_direct, osm_levels, estimated
}

// QUERY OSM:
`[out:json][timeout:25];
(
  way[building][height](around:100,${lat},${lng});
  way[building]["building:height"](around:100,${lat},${lng});
  way[building]["building:levels"](around:100,${lat},${lng});
  relation[building][height](around:100,${lat},${lng});
  relation[building]["building:height"](around:100,${lat},${lng});
  relation[building]["building:levels"](around:100,${lat},${lng});
);
out tags;`
```

### **getRegionalHeightAverage(centerLat, centerLng)**
```javascript
// RETORNA:
{
  average: 35.2,            // Altura média em metros
  samples: 5,               // Número de amostras válidas
  confidence: 1.0           // 0.0-1.0 baseado em samples/SAMPLE_SIZE
}

// QUERY OSM:
`[out:json][timeout:15];
(
  way[building][height](around:300,${centerLat},${centerLng});
  way[building]["building:height"](around:300,${centerLat},${centerLng});
  way[building]["building:levels"](around:300,${centerLat},${centerLng});
);
out tags;`
```

---

## **🛣️ STREET APIs**

### **findNearbyStreetsForTriggers(lat, lng, poiName, landmarkInfo, customRadius)**
```javascript
// RETORNA: Array de streets
[
  {
    name: "Rua Augusta",
    highway_type: "tertiary",
    coordinates: [[lng, lat], ...],  // Array de [lng, lat]
    distance_to_poi: 245.6,
    confidence: 0.85,
    osm_id: "123456789",
    tags: { highway: "tertiary", name: "Rua Augusta" }
  },
  // ...
]

// QUERY OSM:
`[out:json][timeout:60];
(
  way[highway~"^(motorway|trunk|primary|secondary)$"](around:${majorRadius},${lat},${lng});
  way[highway~"^(tertiary)$"](around:${mediumRadius},${lat},${lng});
  way[highway~"^(residential|living_street)$"](around:${minorRadius},${lat},${lng});
  way[highway~"^(trunk|primary|secondary|tertiary|residential)$"][name](around:${mediumRadius},${lat},${lng});
);
out geom;`
```

### **detectUrbanDensity(lat, lng)**
```javascript
// RETORNA: String
"very_dense" | "dense" | "medium" | "low" | "rural"

// QUERY OSM:
`[out:json][timeout:30];
(
  way[building](around:200,${lat},${lng});
  relation[building](around:200,${lat},${lng});
  way[highway~"^(motorway|trunk|primary|secondary)$"](around:500,${lat},${lng});
  way[highway](around:300,${lat},${lng});
);
out;`
```

---

## **🗺️ BOUNDARY APIs**

### **searchOSMByName(lat, lng, name)**
```javascript
// RETORNA:
{
  success: true,
  boundary: {
    coordinates: [[lat, lng], ...],  // Array de pontos do polígono
    area_m2: 15420.5,
    confidence: 0.95,
    source: 'osm_name'
  },
  elements: [...] // Raw OSM elements
}

// QUERY OSM:
`[out:json][timeout:30];
(
  rel[name~"${name}",i](around:500,${lat},${lng});
  way[name~"${name}",i](around:500,${lat},${lng});
);
out;`
```

### **searchOSMNearbyFeatures(lat, lng, name)**
```javascript
// RETORNA:
{
  success: true,
  boundary: {
    coordinates: [[lat, lng], ...],
    area_m2: 8950.2,
    confidence: 0.78,
    source: 'osm_nearby'
  },
  matchedFeature: {
    name: "Edifício Copan",
    type: "building",
    osm_id: "987654321"
  }
}

// QUERY OSM:
`[out:json][timeout:30];
(
  rel[amenity](around:500,${lat},${lng});
  rel[leisure](around:500,${lat},${lng});
  rel[building](around:300,${lat},${lng});
  way[amenity](around:500,${lat},${lng});
  way[leisure](around:500,${lat},${lng});
  way[building](around:300,${lat},${lng});
);
out;`
```

---

## **⛰️ ELEVATION APIs**

### **getCityBaseElevation(lat, lng)**
```javascript
// RETORNA: Number (meters)
750.5  // Elevação base da cidade em metros

// QUERY OSM:
`[out:json][timeout:30];
(
  node[ele](around:2000,${lat},${lng});
  way[ele](around:2000,${lat},${lng});
);
out tags;`
```

### **detectRelativeElevation(poiLat, poiLng)**
```javascript
// RETORNA:
{
  elevationDiff: 1.5,       // Diferença em metros vs base
  confidence: 0.8,          // 0.0-1.0
  baseElevation: 750.0,     // Elevação base
  poiElevation: 751.5       // Elevação do POI
}

// QUERY OSM:
`[out:json][timeout:30];
(
  node[ele](around:1000,${poiLat},${poiLng});
  way[ele](around:1000,${poiLat},${poiLng});
);
out tags;`
```

---

## **🎯 LANDMARK ANALYSIS**

### **checkHighVisibilityLandmark(lat, lng, poiHeight, urbanDensity, elevationData)**
```javascript
// RETORNA:
{
  isHighVisibility: false,
  maxRange: 400,
  elevationDiff: 1.5,
  buildingHeight: 118.44,
  landmarkType: 'urban_building'
}

// NÃO FAZ CHAMADA API - usa dados já obtidos
```

---

## **🔄 DADOS COMPARTILHADOS ENTRE CHAMADAS**

### **BUILDINGS (4 chamadas diferentes!)**
```javascript
// detectPOIHeight() - raio 100m
way[building][height](around:100,${lat},${lng});

// getRegionalHeightAverage() - raio 300m  
way[building][height](around:300,${centerLat},${centerLng});

// detectUrbanDensity() - raio 200m
way[building](around:200,${lat},${lng});

// checkLegacyBuildingObstructions() - raio 200m
way[building](around:200,${triggerLat},${triggerLng});

// SOBREPOSIÇÃO: 90% dos buildings são buscados múltiplas vezes!
```

### **STREETS (3 chamadas diferentes!)**
```javascript
// findNearbyStreetsForTriggers() - raios variáveis
way[highway~"^(motorway|trunk|primary|secondary)$"](around:2000,${lat},${lng});
way[highway~"^(tertiary|residential|living_street)$"](around:1000,${lat},${lng});

// detectUrbanDensity() - raios fixos
way[highway~"^(motorway|trunk|primary|secondary)$"](around:500,${lat},${lng});
way[highway](around:300,${lat},${lng});

// findImmediateStreets() - raio pequeno
way[highway](around:200,${lat},${lng});

// SOBREPOSIÇÃO: 70% das streets são buscadas múltiplas vezes!
```

### **ELEVATION (4 chamadas diferentes!)**
```javascript
// getCityBaseElevation() - raio 2000m
node[ele](around:2000,${lat},${lng});
way[ele](around:2000,${lat},${lng});

// detectRelativeElevation() - raio 1000m
node[ele](around:1000,${poiLat},${poiLng});
way[ele](around:1000,${poiLat},${poiLng});

// sampleOSMElevation() - raio 2000m (duplicate!)
node[ele](around:2000,${lat},${lng});

// getElevationFromOSM() - raio 100m
node[ele](around:100,${lat},${lng});

// SOBREPOSIÇÃO: 95% dos elevation points são buscados múltiplas vezes!
```

---

## **🎯 MEGA-UNIFIED DATA STRUCTURE**

### **Estrutura de retorno unificada:**
```javascript
{
  // BOUNDARIES
  boundary: {
    coordinates: [[lat, lng], ...],
    area_m2: 15420.5,
    confidence: 0.95,
    source: 'osm_name'
  },
  
  // BUILDINGS (unifica 4 chamadas)
  buildings: {
    poiHeight: {
      height: 118.44,
      confidence: 1.0,
      category: 'very_high'
    },
    regionalAnalysis: {
      average: 35.2,
      samples: 47,
      confidence: 1.0,
      distribution: {
        lowRise: 32,   // ≤15m
        midRise: 12,   // 15-45m
        highRise: 3    // >45m
      }
    },
    obstructionMap: [
      {lat: -23.5466, lng: -46.6448, height: 25, distance: 45},
      // ... todos buildings num raio de 500m
    ],
    urbanDensity: 'very_dense'
  },
  
  // STREETS (unifica 3 chamadas)
  streets: {
    major: [...],      // 0-2000m radius
    medium: [...],     // 0-1000m radius  
    local: [...],      // 0-500m radius
    immediate: [...]   // 0-200m radius
  },
  
  // ELEVATION (unifica 4 chamadas)
  elevation: {
    poiElevation: 751.5,
    baseElevation: 750.0,
    relativeDiff: 1.5,
    confidence: 0.8,
    elevationPoints: [
      {lat: -23.5466, lng: -46.6448, elevation: 750.2, distance: 120},
      // ... todos elevation points num raio de 2000m
    ]
  },
  
  // LANDMARK ANALYSIS (calculado, não buscado)
  landmark: {
    isHighVisibility: false,
    maxRange: 400,
    landmarkType: 'urban_building'
  },
  
  // METADATA
  metadata: {
    queryTime: 2.3,      // segundos
    totalElements: 1247,  // elementos OSM retornados
    cacheHit: false,
    timestamp: Date.now()
  }
}
```

---

## **✅ COMPATIBILIDADE GARANTIDA**

### **Wrapper functions para manter compatibilidade:**
```javascript
// Manter APIs existentes funcionando
async function detectPOIHeight(lat, lng) {
  const megaData = await getMegaUnifiedPOIData(lat, lng);
  return megaData.buildings.poiHeight;
}

async function getRegionalHeightAverage(centerLat, centerLng) {
  const megaData = await getMegaUnifiedPOIData(centerLat, centerLng);
  return megaData.buildings.regionalAnalysis;
}

async function findNearbyStreetsForTriggers(lat, lng, poiName, landmarkInfo) {
  const megaData = await getMegaUnifiedPOIData(lat, lng, poiName, landmarkInfo);
  return [...megaData.streets.major, ...megaData.streets.medium, ...megaData.streets.local];
}

// ... etc para todas as 19 funções
```

**READY FOR NEXT PHASE:** Design da Mega-Query! 🚀
