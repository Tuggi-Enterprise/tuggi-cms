/**
 * EXEMPLO DE USO DA CONFIGURAÇÃO CENTRALIZADA
 * 
 * Este arquivo mostra como usar e personalizar as configurações de trigger points
 */

import { loadTriggerPointsConfig, TriggerPointsConfig, DEFAULT_TRIGGER_POINTS_CONFIG } from './trigger-points-config';

// =====================================
// EXEMPLO 1: USAR CONFIGURAÇÃO PRÉ-DEFINIDA
// =====================================

// Usar configuração padrão
const defaultConfig = loadTriggerPointsConfig('default');

// Usar configuração conservadora (menos TPs)
const conservativeConfig = loadTriggerPointsConfig('conservative');

// Usar configuração agressiva (mais TPs)
const aggressiveConfig = loadTriggerPointsConfig('aggressive');

// Usar configuração para landmarks (POIs muito altos)
const landmarkConfig = loadTriggerPointsConfig('landmark');

// =====================================
// EXEMPLO 2: CRIAR CONFIGURAÇÃO PERSONALIZADA
// =====================================

const customConfig: TriggerPointsConfig = {
  ...DEFAULT_TRIGGER_POINTS_CONFIG,
  
  // Aumentar raio de busca para POIs altos
  searchRadius: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.searchRadius,
    heightMultipliers: {
      extremely_tall: {
        multiplier: 5, // 5m raio por metro de diferença (era 3)
        maxRadius: 1000, // máximo 1km (era 800m)
        minRadius: 250 // mínimo 250m (era 200m)
      },
      very_tall: {
        multiplier: 3, // 3m raio por metro de diferença (era 2.5)
        maxRadius: 500, // máximo 500m (era 400m)
        minRadius: 120 // mínimo 120m (era 100m)
      },
      tall: {
        multiplier: 2.5, // 2.5m raio por metro de diferença (era 2)
        maxRadius: 250, // máximo 250m (era 200m)
        minRadius: 80 // mínimo 80m (era 60m)
      },
      medium: {
        multiplier: 2, // 2m raio por metro de diferença (era 1.5)
        maxRadius: 120, // máximo 120m (era 100m)
        minRadius: 50 // mínimo 50m (era 40m)
      }
    }
  },
  
  // Aumentar limite de TPs para POIs altos
  maxTriggerPoints: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.maxTriggerPoints,
    heightAdjustments: {
      extremely_tall: {
        percentage: 0.12, // 12% dos candidatos (era 8%)
        maxLimit: 150 // máximo 150 TPs (era 120)
      },
      very_tall: {
        percentage: 0.08, // 8% dos candidatos (era 6%)
        maxLimit: 100 // máximo 100 TPs (era 80)
      },
      tall: {
        percentage: 0.06, // 6% dos candidatos (era 5%)
        maxLimit: 80 // máximo 80 TPs (era 70)
      },
      medium: {
        percentage: 0.04, // 4% dos candidatos (era 3%)
        maxLimit: 60 // máximo 60 TPs (era 50)
      }
    }
  }
};

// =====================================
// EXEMPLO 3: CONFIGURAÇÃO PARA TESTE ESPECÍFICO
// =====================================

// Configuração para testar com raio muito grande
const testLargeRadiusConfig: TriggerPointsConfig = {
  ...DEFAULT_TRIGGER_POINTS_CONFIG,
  searchRadius: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.searchRadius,
    baseRadius: {
      very_dense: 500, // 500m (era 150m)
      dense: 600, // 600m (era 200m)
      medium: 700, // 700m (era 300m)
      low: 800, // 800m (era 400m)
      rural: 1000 // 1000m (era 500m)
    },
    limits: {
      min: 500, // mínimo 500m (era 150m)
      max: 10000 // máximo 10km (era 5km)
    }
  }
};

// =====================================
// EXEMPLO 4: CONFIGURAÇÃO PARA POIS PEQUENOS
// =====================================

// Configuração para POIs pequenos (restaurantes, lojas)
const smallPOIConfig: TriggerPointsConfig = {
  ...DEFAULT_TRIGGER_POINTS_CONFIG,
  searchRadius: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.searchRadius,
    baseRadius: {
      very_dense: 50, // 50m
      dense: 75, // 75m
      medium: 100, // 100m
      low: 150, // 150m
      rural: 200 // 200m
    },
    limits: {
      min: 50, // mínimo 50m
      max: 500 // máximo 500m
    }
  },
  maxTriggerPoints: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.maxTriggerPoints,
    basePercentage: 0.02, // 2% dos candidatos (era 3%)
    limits: {
      min: 2, // mínimo 2 TPs (era 3)
      max: 20 // máximo 20 TPs (era 150)
    }
  }
};

// =====================================
// EXEMPLO 5: COMO USAR NO CÓDIGO
// =====================================

// Exemplo de como passar a configuração para o sistema
export function generateTriggerPointsWithConfig(poiId: string, configName: string) {
  const config = loadTriggerPointsConfig(configName);
  
  // Passar a configuração para o sistema
  // (isso seria implementado nos serviços)
  console.log(`Using config: ${configName}`);
  console.log(`Base radius for very_dense: ${config.searchRadius.baseRadius.very_dense}m`);
  console.log(`Max TPs for extremely tall POIs: ${config.maxTriggerPoints.heightAdjustments.extremely_tall.maxLimit}`);
  
  return config;
}

// =====================================
// EXEMPLO 6: CONFIGURAÇÃO DINÂMICA
// =====================================

// Função para criar configuração baseada no tipo de POI
export function createConfigForPOIType(poiType: string): TriggerPointsConfig {
  switch (poiType) {
    case 'church':
    case 'cathedral':
    case 'basilica':
      return loadTriggerPointsConfig('landmark');
    
    case 'restaurant':
    case 'cafe':
    case 'shop':
      return smallPOIConfig;
    
    case 'museum':
    case 'monument':
      return loadTriggerPointsConfig('aggressive');
    
    default:
      return loadTriggerPointsConfig('default');
  }
}

// =====================================
// EXEMPLO 7: CONFIGURAÇÃO POR REGIÃO
// =====================================

// Configuração para cidades europeias (ruas mais estreitas)
const europeanCityConfig: TriggerPointsConfig = {
  ...DEFAULT_TRIGGER_POINTS_CONFIG,
  searchRadius: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.searchRadius,
    baseRadius: {
      very_dense: 100, // Menor raio para ruas estreitas
      dense: 150,
      medium: 200,
      low: 300,
      rural: 400
    }
  },
  minDistance: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.minDistance,
    baseDistance: {
      very_dense: 30, // Menor distância entre TPs
      dense: 35,
      medium: 40,
      low: 50,
      rural: 60
    }
  }
};

// Configuração para cidades americanas (ruas mais largas)
const americanCityConfig: TriggerPointsConfig = {
  ...DEFAULT_TRIGGER_POINTS_CONFIG,
  searchRadius: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.searchRadius,
    baseRadius: {
      very_dense: 200, // Maior raio para ruas largas
      dense: 250,
      medium: 350,
      low: 450,
      rural: 600
    }
  },
  minDistance: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.minDistance,
    baseDistance: {
      very_dense: 50, // Maior distância entre TPs
      dense: 60,
      medium: 70,
      low: 80,
      rural: 90
    }
  }
};

// =====================================
// EXEMPLO 8: CONFIGURAÇÃO PARA TESTE A/B
// =====================================

// Configuração A: Mais TPs próximos
const configA: TriggerPointsConfig = {
  ...DEFAULT_TRIGGER_POINTS_CONFIG,
  searchRadius: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.searchRadius,
    baseRadius: {
      very_dense: 100,
      dense: 150,
      medium: 200,
      low: 300,
      rural: 400
    }
  },
  maxTriggerPoints: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.maxTriggerPoints,
    basePercentage: 0.05, // 5% dos candidatos
    limits: {
      min: 5,
      max: 100
    }
  }
};

// Configuração B: Menos TPs mais distantes
const configB: TriggerPointsConfig = {
  ...DEFAULT_TRIGGER_POINTS_CONFIG,
  searchRadius: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.searchRadius,
    baseRadius: {
      very_dense: 300,
      dense: 400,
      medium: 500,
      low: 600,
      rural: 800
    }
  },
  maxTriggerPoints: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.maxTriggerPoints,
    basePercentage: 0.02, // 2% dos candidatos
    limits: {
      min: 3,
      max: 50
    }
  }
};

// Função para alternar entre configurações A e B
export function getABTestConfig(testGroup: 'A' | 'B'): TriggerPointsConfig {
  return testGroup === 'A' ? configA : configB;
}
