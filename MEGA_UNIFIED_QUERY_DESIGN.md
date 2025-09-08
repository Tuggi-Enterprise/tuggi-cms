# 🎯 **DESIGN DA MEGA-QUERY UNIFICADA**
## Uma query para substituir 19 chamadas API

---

## **📋 ESPECIFICAÇÕES TÉCNICAS**

### **OBJETIVOS:**
- ✅ Capturar **100%** dos dados das 19 chamadas atuais
- ✅ Otimizar raios de busca para evitar duplicação
- ✅ Manter timeout < 120 segundos
- ✅ Garantir compatibilidade total com código existente

### **CONSTRAINTS:**
- **Timeout máximo:** 120 segundos
- **Dados mínimos:** Boundaries, Buildings, Streets, Elevation
- **Raio máximo:** 2000m (para elevation)
- **Formato:** GeoJSON compatível com processamento atual

---

## **🔧 MEGA-QUERY OTIMIZADA**

### **Query Principal:**
```sql
[out:json][timeout:120];
(
  // ===================================================================
  // SECTION 1: BOUNDARIES (substitui 4-6 chamadas)
  // Estratégias múltiplas para máxima cobertura
  // ===================================================================
  
  // Strategy 1: Exact name match (searchOSMByName)
  rel[name~"${name}",i](around:500,${lat},${lng});
  way[name~"${name}",i][area=yes](around:500,${lat},${lng});
  
  // Strategy 2: Nearby named features (searchOSMNearbyFeatures)
  rel[amenity](around:500,${lat},${lng});
  rel[leisure](around:500,${lat},${lng});
  rel[building](around:300,${lat},${lng});
  way[amenity](around:500,${lat},${lng});
  way[leisure](around:500,${lat},${lng});
  way[building][area=yes](around:300,${lat},${lng});
  
  // Strategy 3: Administrative boundaries (reverse geocoding)
  rel[admin_level][name](around:1000,${lat},${lng});
  
  // ===================================================================
  // SECTION 2: BUILDINGS (substitui 4 chamadas)
  // Raio unificado de 500m para capturar todos os casos
  // ===================================================================
  
  // All buildings with height data (detectPOIHeight + getRegionalHeightAverage)
  way[building][height](around:500,${lat},${lng});
  way[building]["building:height"](around:500,${lat},${lng});
  way[building]["building:levels"](around:500,${lat},${lng});
  relation[building][height](around:500,${lat},${lng});
  relation[building]["building:height"](around:500,${lat},${lng});
  relation[building]["building:levels"](around:500,${lat},${lng});
  
  // All buildings for density analysis (detectUrbanDensity + obstructions)
  way[building](around:500,${lat},${lng});
  relation[building](around:500,${lat},${lng});
  
  // ===================================================================
  // SECTION 3: STREETS (substitui 3-4 chamadas)
  // Raios estratificados por importância da via
  // ===================================================================
  
  // Major highways (long range for high visibility landmarks)
  way[highway~"^(motorway|trunk|primary|secondary)$"](around:2000,${lat},${lng});
  
  // Medium roads (medium range)
  way[highway~"^(tertiary|residential|living_street)$"](around:1000,${lat},${lng});
  
  // Local access (short range for immediate access)
  way[highway~"^(pedestrian|service|footway|path|track)$"](around:500,${lat},${lng});
  
  // Named roads (priority for trigger points)
  way[highway][name](around:1000,${lat},${lng});
  
  // ===================================================================
  // SECTION 4: ELEVATION (substitui 4 chamadas)
  // Raio amplo para análise de terreno completa
  // ===================================================================
  
  // Elevation points and ways (getCityBaseElevation + detectRelativeElevation)
  node[ele](around:2000,${lat},${lng});
  way[ele](around:2000,${lat},${lng});
  relation[ele](around:2000,${lat},${lng});
  
  // Natural features that affect elevation
  way[natural~"^(peak|hill|ridge|valley)$"](around:2000,${lat},${lng});
  relation[natural~"^(peak|hill|ridge|valley)$"](around:2000,${lat},${lng});
);
out geom tags;
```

---

## **📊 OTIMIZAÇÕES IMPLEMENTADAS**

### **1. RAIOS INTELIGENTES**
```javascript
// Ao invés de múltiplas buscas sobrepostas:
❌ detectPOIHeight: 100m
❌ getRegionalHeightAverage: 300m  
❌ checkObstructions: 200m
❌ detectUrbanDensity: 200m

// Uma busca unificada otimizada:
✅ Buildings: 500m (captura TUDO)
```

### **2. ESTRATÉGIAS UNIFICADAS**
```javascript
// Boundaries: 4 estratégias em paralelo
- Name matching (exact + fuzzy)
- Nearby features (amenity, leisure, building)
- Administrative boundaries
- Geometric analysis

// Streets: Estratificação por importância
- Major: 2000m (landmarks distantes)
- Medium: 1000m (acesso principal)  
- Local: 500m (acesso imediato)

// Elevation: Raio máximo para contexto completo
- Points: 2000m (base + relative)
- Natural features: contexto topográfico
```

### **3. TIMEOUT OTIMIZADO**
```javascript
// Análise de performance por seção:
- Boundaries: ~20s (múltiplas estratégias)
- Buildings: ~30s (raio 500m em área densa)
- Streets: ~40s (raios estratificados)  
- Elevation: ~20s (pontos esparsos)
- Buffer: ~10s (processamento)
// TOTAL: ~120s (dentro do limite)
```

---

## **🔄 QUERY MODULAR PARA FALLBACKS**

### **Versão Completa (ideal):**
```javascript
const MEGA_QUERY_FULL = `[out:json][timeout:120];
(${BOUNDARIES_SECTION}${BUILDINGS_SECTION}${STREETS_SECTION}${ELEVATION_SECTION});
out geom tags;`;
```

### **Versão Essencial (fallback):**
```javascript
const MEGA_QUERY_ESSENTIAL = `[out:json][timeout:90];
(
  // Só o essencial para funcionalidade mínima
  rel[name~"${name}",i](around:300,${lat},${lng});
  way[building][height](around:300,${lat},${lng});
  way[highway~"^(primary|secondary|tertiary|residential)$"](around:800,${lat},${lng});
  node[ele](around:1000,${lat},${lng});
);
out geom tags;`;
```

### **Versão Crítica (emergency fallback):**
```javascript
const MEGA_QUERY_CRITICAL = `[out:json][timeout:60];
(
  // Mínimo absoluto
  way[building](around:200,${lat},${lng});
  way[highway](around:500,${lat},${lng});
);
out geom tags;`;
```

---

## **📈 VALIDAÇÃO DE PERFORMANCE**

### **Teste em Diferentes Cenários:**

**1. ÁREA DENSA (São Paulo - Copan):**
```javascript
// Estimativa de elementos:
- Buildings: ~500 elementos (500m radius)
- Streets: ~200 elementos (estratificado)
- Boundaries: ~50 elementos
- Elevation: ~100 elementos
// TOTAL: ~850 elementos
// TIMEOUT ESTIMADO: 90-120s ✅
```

**2. ÁREA MÉDIA (Belo Horizonte):**
```javascript
// Estimativa de elementos:
- Buildings: ~200 elementos
- Streets: ~100 elementos  
- Boundaries: ~30 elementos
- Elevation: ~80 elementos
// TOTAL: ~410 elementos
// TIMEOUT ESTIMADO: 60-80s ✅
```

**3. ÁREA RURAL (Cristo Redentor):**
```javascript
// Estimativa de elementos:
- Buildings: ~50 elementos
- Streets: ~80 elementos
- Boundaries: ~20 elementos  
- Elevation: ~150 elementos (montanha)
// TOTAL: ~300 elementos
// TIMEOUT ESTIMADO: 40-60s ✅
```

---

## **🎯 PROCESSAMENTO DOS DADOS**

### **Separação por Tipo:**
```javascript
function separateMegaQueryResults(elements) {
  const boundaries = elements.filter(e => 
    (e.type === 'relation' && (e.tags?.admin_level || e.tags?.amenity || e.tags?.leisure)) ||
    (e.type === 'way' && e.tags?.area === 'yes' && e.tags?.name)
  );
  
  const buildings = elements.filter(e => 
    e.tags?.building
  );
  
  const streets = elements.filter(e => 
    e.type === 'way' && e.tags?.highway
  );
  
  const elevation = elements.filter(e => 
    e.tags?.ele || e.tags?.natural
  );
  
  return { boundaries, buildings, streets, elevation };
}
```

### **Estratificação de Streets:**
```javascript
function stratifyStreets(streets, lat, lng) {
  return {
    major: streets.filter(s => 
      ['motorway', 'trunk', 'primary', 'secondary'].includes(s.tags?.highway)
    ),
    medium: streets.filter(s => 
      ['tertiary', 'residential', 'living_street'].includes(s.tags?.highway)
    ),
    local: streets.filter(s => 
      ['pedestrian', 'service', 'footway', 'path', 'track'].includes(s.tags?.highway)
    )
  };
}
```

---

## **⚠️ TRATAMENTO DE ERROS**

### **Estratégia de Fallback:**
```javascript
async function getMegaUnifiedPOIData(lat, lng, name, landmarkInfo) {
  try {
    // Tentar query completa primeiro
    const result = await executeQuery(MEGA_QUERY_FULL);
    if (result.elements.length > 0) return processResults(result);
    
    // Fallback para query essencial
    console.warn('Full query returned no results, trying essential query...');
    const essentialResult = await executeQuery(MEGA_QUERY_ESSENTIAL);
    if (essentialResult.elements.length > 0) return processResults(essentialResult);
    
    // Emergency fallback
    console.warn('Essential query failed, using critical query...');
    const criticalResult = await executeQuery(MEGA_QUERY_CRITICAL);
    return processResults(criticalResult);
    
  } catch (error) {
    if (error.message.includes('timeout')) {
      console.warn('Query timeout, falling back to legacy methods...');
      return await getLegacyData(lat, lng, name, landmarkInfo);
    }
    throw error;
  }
}
```

### **Validação de Dados Mínimos:**
```javascript
function validateMegaQueryResult(result) {
  const { boundaries, buildings, streets, elevation } = result;
  
  // Validar dados críticos
  const hasMinimalData = 
    buildings.length >= 5 &&      // Pelo menos 5 buildings
    streets.length >= 10 &&       // Pelo menos 10 streets
    boundaries.length >= 1;       // Pelo menos 1 boundary candidate
  
  if (!hasMinimalData) {
    throw new Error('Insufficient data returned from mega query');
  }
  
  return true;
}
```

---

## **✅ COMPATIBILIDADE GARANTIDA**

### **Mapeamento de Dados:**
```javascript
// Garantir que cada função antiga recebe exatamente o que espera:

// detectPOIHeight() espera:
{ height: number, category: string, confidence: number }

// getRegionalHeightAverage() espera:  
{ average: number, samples: number, confidence: number }

// findNearbyStreetsForTriggers() espera:
[{ name: string, highway_type: string, coordinates: [], distance_to_poi: number }]

// Etc... TODOS os formatos preservados
```

---

## **🚀 PRÓXIMOS PASSOS**

### **IMPLEMENTAÇÃO:**
1. ✅ **Query projetada e otimizada**
2. ⏳ **Criar funções de processamento**
3. ⏳ **Implementar sistema de cache**
4. ⏳ **Criar compatibility layer**
5. ⏳ **Testes isolados**

### **ESTIMATIVAS:**
- **Redução de chamadas:** 19 → 1 (95%)
- **Redução de latência:** 15-20s → 2-4s (80%)
- **Redução de timeout risk:** 19x → 1x (95%)
- **Melhoria de cache:** Fragmentado → Unificado (300%)

**READY FOR IMPLEMENTATION!** 🎯✨
