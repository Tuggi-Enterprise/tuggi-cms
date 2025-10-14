/**
 * CONFIGURAÇÃO CENTRALIZADA DE TRIGGER POINTS
 * 
 * Este arquivo contém todas as configurações ajustáveis para o sistema de trigger points.
 * Modifique os valores aqui para testar diferentes comportamentos sem alterar o código.
 */

export interface TriggerPointsConfig {
  // =====================================
  // CONFIGURAÇÕES DE RAIO DE BUSCA
  // =====================================
  searchRadius: {
    // Raio base para diferentes densidades urbanas
    baseRadius: {
      very_dense: number;
      dense: number;
      medium: number;
      low: number;
      rural: number;
    };
    
    // Multiplicadores por altura do POI (áreas densas)
    heightMultipliers: {
      extremely_tall: { // >100m diferença
        multiplier: number;
        maxRadius: number;
        minRadius: number;
      };
      very_tall: { // 50-100m diferença
        multiplier: number;
        maxRadius: number;
        minRadius: number;
      };
      tall: { // 20-50m diferença
        multiplier: number;
        maxRadius: number;
        minRadius: number;
      };
      medium: { // 0-20m diferença
        multiplier: number;
        maxRadius: number;
        minRadius: number;
      };
    };
    
    // Multiplicadores por altura do POI (áreas não densas)
    nonDenseHeightMultipliers: {
      very_tall: number;
      tall: number;
      low: number;
    };
    
    // Limites absolutos
    limits: {
      min: number;
      max: number;
    };
  };

  // =====================================
  // CONFIGURAÇÕES DE LIMITE DE TPs
  // =====================================
  maxTriggerPoints: {
    // Percentual base dos candidatos
    basePercentage: number;
    
    // Ajustes por altura do POI
    heightAdjustments: {
      extremely_tall: { // >100m
        percentage: number;
        maxLimit: number;
      };
      very_tall: { // 50-100m
        percentage: number;
        maxLimit: number;
      };
      tall: { // 20-50m
        percentage: number;
        maxLimit: number;
      };
      medium: { // <20m
        percentage: number;
        maxLimit: number;
      };
    };
    
    // Ajustes por área do POI
    areaAdjustments: {
      very_large: { // >1km²
        percentage: number;
        maxLimit: number;
      };
      large: { // >0.5km²
        percentage: number;
        maxLimit: number;
      };
    };
    
    // Ajustes por elevação
    elevationAdjustments: {
      high_landmark: { // >100m diferença
        percentage: number;
        maxLimit: number;
      };
    };
    
    // Limites absolutos
    limits: {
      min: number;
      max: number;
    };
  };

  // =====================================
  // CONFIGURAÇÕES DE DISTÂNCIA MÍNIMA
  // =====================================
  minDistance: {
    // Distância base por densidade urbana
    baseDistance: {
      very_dense: number;
      dense: number;
      medium: number;
      low: number;
      rural: number;
    };
    
    // Multiplicadores por tamanho do POI
    areaMultipliers: {
      very_large: number; // >500k m²
      large: number; // >100k m²
    };
    
    // Multiplicadores por elevação
    elevationMultipliers: {
      high: number; // >50m diferença
    };
    
    // Multiplicadores por altura do POI
    heightMultipliers: {
      tall: number; // >50m
    };
    
    // Limites absolutos
    limits: {
      min: number;
      max: number;
    };
  };

  // =====================================
  // CONFIGURAÇÕES DE VISIBILIDADE
  // =====================================
  visibility: {
    // Distâncias para auto-aprovação
    autoApproval: {
      frontStreetDistance: number; // TPs muito próximos do boundary
      veryCloseDistance: number; // TPs muito próximos do POI
    };
    
    // Multiplicadores de visibilidade
    multipliers: {
      estimatedVisibilityRate: number; // Taxa estimada de sucesso
      obstructionPenalty: {
        baseDensity: number; // Densidade média estimada
        maxDensity: number; // Densidade máxima para cálculo
      };
    };
  };

  // =====================================
  // CONFIGURAÇÕES DE QUALIDADE
  // =====================================
  quality: {
    // Pontuação base por tipo de rua
    streetTypeScores: {
      motorway: number;
      trunk: number;
      primary: number;
      secondary: number;
      tertiary: number;
      residential: number;
      unclassified: number;
    };
    
    // Bonus por características
    bonuses: {
      frontStreet: number;
      highVisibility: number;
      optimalDistance: number;
    };
  };

  // =====================================
  // CONFIGURAÇÕES DE DISTRIBUIÇÃO DE DISTÂNCIAS
  // =====================================
  distanceDistribution: {
    // Estratégia circular para alta elevação
    circular: {
      inner: number;        // Círculo interno - próximo
      near_medium: number;  // Círculo próximo-médio  
      medium: number;       // Círculo médio
      medium_far: number;   // Círculo médio-distante
      far: number;          // Círculo distante
      max: number;          // Círculo máximo
    };
    
    // Estratégia padrão para baixa elevação
    standard: {
      baseDistance: number; // Distância base padrão
      
      // Limites por densidade urbana
      urbanDensityLimits: {
        very_dense: number;
        dense: number;
        medium: number;
        low: number;
        rural: number;
      };
      
      // Distâncias para montanhas altas (>800m)
      mountainHigh: {
        distances: number[];
      };
      
      // Distâncias para montanhas médias (400-800m)
      mountainMedium: {
        distances: number[];
      };
    };
  };
}

// =====================================
// CONFIGURAÇÃO PADRÃO
// =====================================
export const DEFAULT_TRIGGER_POINTS_CONFIG: TriggerPointsConfig = {
  searchRadius: {
    baseRadius: {
      very_dense: 150,
      dense: 200,
      medium: 300,
      low: 400,
      rural: 500
    },
    
    heightMultipliers: {
      extremely_tall: {
        multiplier: 3, // 3m raio por metro de diferença
        maxRadius: 800,
        minRadius: 200
      },
      very_tall: {
        multiplier: 2.5, // 2.5m raio por metro de diferença
        maxRadius: 400,
        minRadius: 100
      },
      tall: {
        multiplier: 2, // 2m raio por metro de diferença
        maxRadius: 200,
        minRadius: 60
      },
      medium: {
        multiplier: 1.5, // 1.5m raio por metro de diferença
        maxRadius: 100,
        minRadius: 40
      }
    },
    
    nonDenseHeightMultipliers: {
      very_tall: 4, // 4m raio por metro de diferença
      tall: 2, // 2m raio por metro de diferença
      low: 0.5 // 0.5m raio por metro de diferença
    },
    
    limits: {
      min: 150,
      max: 5000
    }
  },

  maxTriggerPoints: {
    basePercentage: 0.03, // 3% dos candidatos
    
    heightAdjustments: {
      extremely_tall: {
        percentage: 0.08, // 8% dos candidatos
        maxLimit: 120
      },
      very_tall: {
        percentage: 0.06, // 6% dos candidatos
        maxLimit: 80
      },
      tall: {
        percentage: 0.05, // 5% dos candidatos
        maxLimit: 70
      },
      medium: {
        percentage: 0.03, // 3% dos candidatos
        maxLimit: 50
      }
    },
    
    areaAdjustments: {
      very_large: {
        percentage: 0.07, // 7% dos candidatos
        maxLimit: 100
      },
      large: {
        percentage: 0.06, // 6% dos candidatos
        maxLimit: 80
      }
    },
    
    elevationAdjustments: {
      high_landmark: {
        percentage: 0.08, // 8% dos candidatos
        maxLimit: 120
      }
    },
    
    limits: {
      min: 3,
      max: 150
    }
  },

  minDistance: {
    baseDistance: {
      very_dense: 40,
      dense: 45,
      medium: 50,
      low: 60,
      rural: 70
    },
    
    areaMultipliers: {
      very_large: 1.3, // +30% para POIs muito grandes
      large: 1.1 // +10% para POIs grandes
    },
    
    elevationMultipliers: {
      high: 1.2 // +20% para POIs em elevação alta
    },
    
    heightMultipliers: {
      tall: 1.1 // +10% para POIs altos
    },
    
    limits: {
      min: 30,
      max: 100
    }
  },

  visibility: {
    autoApproval: {
      frontStreetDistance: 75, // TPs <75m do boundary = auto-aprovado
      veryCloseDistance: 25 // TPs <25m do POI = front street
    },
    
    multipliers: {
      estimatedVisibilityRate: 70, // 70% taxa estimada de sucesso
      obstructionPenalty: {
        baseDensity: 200, // Densidade média estimada
        maxDensity: 500 // Densidade máxima para cálculo
      }
    }
  },

  // Configurações de distribuição de distâncias
  distanceDistribution: {
    // Estratégia circular para alta elevação
    circular: {
      inner: 300,        // Círculo interno - próximo
      near_medium: 800,  // Círculo próximo-médio  
      medium: 1500,      // Círculo médio
      medium_far: 2500,  // Círculo médio-distante
      far: 4000,         // Círculo distante
      max: 6000          // Círculo máximo
    },
    
    // Estratégia padrão para baixa elevação
    standard: {
      baseDistance: 100, // Distância base padrão
      
      // Limites por densidade urbana
      urbanDensityLimits: {
        very_dense: 80,
        dense: 100,
        medium: 120,
        low: 150,
        rural: 180
      },
      
      // Distâncias para montanhas altas (>800m)
      mountainHigh: {
        distances: [200, 600, 1200, 2000]
      },
      
      // Distâncias para montanhas médias (400-800m)
      mountainMedium: {
        distances: [150, 400]
      }
    }
  },

  quality: {
    streetTypeScores: {
      motorway: 0.9,
      trunk: 0.8,
      primary: 0.7,
      secondary: 0.6,
      tertiary: 0.5,
      residential: 0.4,
      unclassified: 0.3
    },
    
    bonuses: {
      frontStreet: 0.2,
      highVisibility: 0.3,
      optimalDistance: 0.1
    }
  }
};

// =====================================
// CONFIGURAÇÕES PRÉ-DEFINIDAS
// =====================================

/**
 * Configuração conservadora - menos TPs, mais próximos
 */
export const CONSERVATIVE_CONFIG: TriggerPointsConfig = {
  ...DEFAULT_TRIGGER_POINTS_CONFIG,
  searchRadius: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.searchRadius,
    baseRadius: {
      very_dense: 100,
      dense: 150,
      medium: 200,
      low: 300,
      rural: 400
    },
    limits: {
      min: 100,
      max: 3000
    }
  },
  maxTriggerPoints: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.maxTriggerPoints,
    basePercentage: 0.02, // 2% dos candidatos
    limits: {
      min: 3,
      max: 50
    }
  },

  // Configurações de distribuição de distâncias
  distanceDistribution: {
    // Estratégia circular para alta elevação
    circular: {
      inner: 300,        // Círculo interno - próximo
      near_medium: 800,  // Círculo próximo-médio  
      medium: 1500,      // Círculo médio
      medium_far: 2500,  // Círculo médio-distante
      far: 4000,         // Círculo distante
      max: 6000          // Círculo máximo
    },
    
    // Estratégia padrão para baixa elevação
    standard: {
      baseDistance: 100, // Distância base padrão
      
      // Limites por densidade urbana
      urbanDensityLimits: {
        very_dense: 80,
        dense: 100,
        medium: 120,
        low: 150,
        rural: 180
      },
      
      // Distâncias para montanhas altas (>800m)
      mountainHigh: {
        distances: [200, 600, 1200, 2000]
      },
      
      // Distâncias para montanhas médias (400-800m)
      mountainMedium: {
        distances: [150, 400]
      }
    }
  }
};

/**
 * Configuração agressiva - mais TPs, mais distantes
 */
export const AGGRESSIVE_CONFIG: TriggerPointsConfig = {
  ...DEFAULT_TRIGGER_POINTS_CONFIG,
  searchRadius: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.searchRadius,
    baseRadius: {
      very_dense: 200,
      dense: 300,
      medium: 400,
      low: 500,
      rural: 600
    },
    limits: {
      min: 200,
      max: 8000
    }
  },
  maxTriggerPoints: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.maxTriggerPoints,
    basePercentage: 0.05, // 5% dos candidatos
    limits: {
      min: 5,
      max: 200
    }
  }
};

/**
 * Configuração para landmarks - otimizada para POIs muito altos
 */
export const LANDMARK_CONFIG: TriggerPointsConfig = {
  ...DEFAULT_TRIGGER_POINTS_CONFIG,
  searchRadius: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.searchRadius,
    heightMultipliers: {
      extremely_tall: {
        multiplier: 4, // 4m raio por metro de diferença
        maxRadius: 1200,
        minRadius: 300
      },
      very_tall: {
        multiplier: 3, // 3m raio por metro de diferença
        maxRadius: 600,
        minRadius: 150
      },
      tall: {
        multiplier: 2.5, // 2.5m raio por metro de diferença
        maxRadius: 300,
        minRadius: 100
      },
      medium: {
        multiplier: 2, // 2m raio por metro de diferença
        maxRadius: 150,
        minRadius: 60
      }
    },
    limits: {
      min: 200,
      max: 10000
    }
  },
  maxTriggerPoints: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.maxTriggerPoints,
    heightAdjustments: {
      extremely_tall: {
        percentage: 0.10, // 10% dos candidatos
        maxLimit: 150
      },
      very_tall: {
        percentage: 0.08, // 8% dos candidatos
        maxLimit: 100
      },
      tall: {
        percentage: 0.06, // 6% dos candidatos
        maxLimit: 80
      },
      medium: {
        percentage: 0.04, // 4% dos candidatos
        maxLimit: 60
      }
    },
    limits: {
      min: 5,
      max: 200
    }
  }
};

// =====================================
// FUNÇÃO PARA CARREGAR CONFIGURAÇÃO
// =====================================

/**
 * Carrega a configuração de trigger points
 * @param configName Nome da configuração ou configuração customizada
 * @returns Configuração de trigger points
 */
export function loadTriggerPointsConfig(configName?: string | TriggerPointsConfig): TriggerPointsConfig {
  if (typeof configName === 'object') {
    return configName; // Configuração customizada
  }
  
  switch (configName) {
    case 'conservative':
      return CONSERVATIVE_CONFIG;
    case 'aggressive':
      return AGGRESSIVE_CONFIG;
    case 'landmark':
      return LANDMARK_CONFIG;
    case 'default':
    default:
      return DEFAULT_TRIGGER_POINTS_CONFIG;
  }
}
