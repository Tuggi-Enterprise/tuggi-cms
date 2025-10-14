/**
 * TESTE RÁPIDO DE CONFIGURAÇÕES
 * 
 * Use este arquivo para testar rapidamente diferentes configurações
 * sem precisar modificar o código principal.
 */

import { loadTriggerPointsConfig, TriggerPointsConfig, DEFAULT_TRIGGER_POINTS_CONFIG } from './trigger-points-config';

// =====================================
// CONFIGURAÇÕES PARA TESTE RÁPIDO
// =====================================

/**
 * CONFIGURAÇÃO 1: MAIS TPs PARA POIS ALTOS
 * 
 * Use esta configuração se quiser mais trigger points para POIs altos
 * como a Sagrada Família, igrejas, monumentos, etc.
 */
export const MORE_TPs_FOR_TALL_POIs: TriggerPointsConfig = {
  ...DEFAULT_TRIGGER_POINTS_CONFIG,
  
  // Aumentar raio de busca para POIs altos
  searchRadius: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.searchRadius,
    heightMultipliers: {
      extremely_tall: {
        multiplier: 4, // 4m raio por metro de diferença (era 3)
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
        percentage: 0.10, // 10% dos candidatos (era 8%)
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

/**
 * CONFIGURAÇÃO 2: RAIOS MUITO GRANDES
 * 
 * Use esta configuração se quiser testar com raios de busca muito grandes
 * para ver se consegue TPs em ruas mais distantes
 */
export const VERY_LARGE_RADIUS: TriggerPointsConfig = {
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
    heightMultipliers: {
      extremely_tall: {
        multiplier: 6, // 6m raio por metro de diferença
        maxRadius: 1500, // máximo 1.5km
        minRadius: 400 // mínimo 400m
      },
      very_tall: {
        multiplier: 4, // 4m raio por metro de diferença
        maxRadius: 800, // máximo 800m
        minRadius: 200 // mínimo 200m
      },
      tall: {
        multiplier: 3, // 3m raio por metro de diferença
        maxRadius: 400, // máximo 400m
        minRadius: 120 // mínimo 120m
      },
      medium: {
        multiplier: 2.5, // 2.5m raio por metro de diferença
        maxRadius: 200, // máximo 200m
        minRadius: 80 // mínimo 80m
      }
    },
    limits: {
      min: 500, // mínimo 500m
      max: 10000 // máximo 10km
    }
  }
};

/**
 * CONFIGURAÇÃO 3: MUITOS TPs
 * 
 * Use esta configuração se quiser o máximo de trigger points possível
 */
export const MAXIMUM_TPs: TriggerPointsConfig = {
  ...DEFAULT_TRIGGER_POINTS_CONFIG,
  
  maxTriggerPoints: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.maxTriggerPoints,
    basePercentage: 0.08, // 8% dos candidatos (era 3%)
    
    heightAdjustments: {
      extremely_tall: {
        percentage: 0.15, // 15% dos candidatos
        maxLimit: 200 // máximo 200 TPs
      },
      very_tall: {
        percentage: 0.12, // 12% dos candidatos
        maxLimit: 150 // máximo 150 TPs
      },
      tall: {
        percentage: 0.10, // 10% dos candidatos
        maxLimit: 120 // máximo 120 TPs
      },
      medium: {
        percentage: 0.08, // 8% dos candidatos
        maxLimit: 100 // máximo 100 TPs
      }
    },
    
    areaAdjustments: {
      very_large: {
        percentage: 0.12, // 12% dos candidatos
        maxLimit: 150 // máximo 150 TPs
      },
      large: {
        percentage: 0.10, // 10% dos candidatos
        maxLimit: 120 // máximo 120 TPs
      }
    },
    
    limits: {
      min: 5, // mínimo 5 TPs
      max: 200 // máximo 200 TPs
    }
  }
};

/**
 * CONFIGURAÇÃO 4: TPs MAIS PRÓXIMOS
 * 
 * Use esta configuração se quiser TPs mais próximos do POI
 */
export const CLOSER_TPs: TriggerPointsConfig = {
  ...DEFAULT_TRIGGER_POINTS_CONFIG,
  
  searchRadius: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.searchRadius,
    baseRadius: {
      very_dense: 100, // 100m (era 150m)
      dense: 150, // 150m (era 200m)
      medium: 200, // 200m (era 300m)
      low: 300, // 300m (era 400m)
      rural: 400 // 400m (era 500m)
    },
    limits: {
      min: 100, // mínimo 100m
      max: 2000 // máximo 2km
    }
  },
  
  minDistance: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.minDistance,
    baseDistance: {
      very_dense: 30, // 30m (era 40m)
      dense: 35, // 35m (era 45m)
      medium: 40, // 40m (era 50m)
      low: 50, // 50m (era 60m)
      rural: 60 // 60m (era 70m)
    }
  }
};

// =====================================
// FUNÇÃO PARA TESTE RÁPIDO
// =====================================

/**
 * Função para testar rapidamente uma configuração
 * 
 * @param configName Nome da configuração para testar
 * @returns Configuração correspondente
 */
export function getTestConfig(configName: string): TriggerPointsConfig {
  switch (configName) {
    case 'more_tps_tall':
      return MORE_TPs_FOR_TALL_POIs;
    
    case 'large_radius':
      return VERY_LARGE_RADIUS;
    
    case 'maximum_tps':
      return MAXIMUM_TPs;
    
    case 'closer_tps':
      return CLOSER_TPs;
    
    case 'default':
    default:
      return DEFAULT_TRIGGER_POINTS_CONFIG;
  }
}

// =====================================
// EXEMPLO DE USO
// =====================================

/**
 * Exemplo de como usar no código:
 * 
 * ```typescript
 * import { getTestConfig } from './config/quick-test';
 * 
 * // Testar com mais TPs para POIs altos
 * const config = getTestConfig('more_tps_tall');
 * 
 * // Usar a configuração no sistema
 * const triggerPoints = await generateTriggerPoints(poiId, config);
 * ```
 */

// =====================================
// CONFIGURAÇÕES ESPECÍFICAS PARA SAGRADA FAMÍLIA
// =====================================

/**
 * CONFIGURAÇÃO ESPECÍFICA PARA SAGRADA FAMÍLIA
 * 
 * Esta configuração foi otimizada especificamente para POIs como a Sagrada Família
 * que são muito altos (170m) em áreas densas
 */
export const SAGRADA_FAMILIA_CONFIG: TriggerPointsConfig = {
  ...DEFAULT_TRIGGER_POINTS_CONFIG,
  
  searchRadius: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.searchRadius,
    heightMultipliers: {
      extremely_tall: {
        multiplier: 5, // 5m raio por metro de diferença
        maxRadius: 1200, // máximo 1.2km
        minRadius: 300 // mínimo 300m
      },
      very_tall: {
        multiplier: 4, // 4m raio por metro de diferença
        maxRadius: 600, // máximo 600m
        minRadius: 150 // mínimo 150m
      },
      tall: {
        multiplier: 3, // 3m raio por metro de diferença
        maxRadius: 300, // máximo 300m
        minRadius: 100 // mínimo 100m
      },
      medium: {
        multiplier: 2.5, // 2.5m raio por metro de diferença
        maxRadius: 150, // máximo 150m
        minRadius: 60 // mínimo 60m
      }
    },
    limits: {
      min: 200, // mínimo 200m
      max: 8000 // máximo 8km
    }
  },
  
  maxTriggerPoints: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.maxTriggerPoints,
    heightAdjustments: {
      extremely_tall: {
        percentage: 0.12, // 12% dos candidatos
        maxLimit: 180 // máximo 180 TPs
      },
      very_tall: {
        percentage: 0.10, // 10% dos candidatos
        maxLimit: 120 // máximo 120 TPs
      },
      tall: {
        percentage: 0.08, // 8% dos candidatos
        maxLimit: 100 // máximo 100 TPs
      },
      medium: {
        percentage: 0.06, // 6% dos candidatos
        maxLimit: 80 // máximo 80 TPs
      }
    },
    limits: {
      min: 5, // mínimo 5 TPs
      max: 200 // máximo 200 TPs
    }
  }
};

/**
 * Função para obter configuração específica para Sagrada Família
 */
export function getSagradaFamiliaConfig(): TriggerPointsConfig {
  return SAGRADA_FAMILIA_CONFIG;
}
