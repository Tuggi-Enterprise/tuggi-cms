/**
 * 🎯 CONFIGURAÇÃO CENTRALIZADA DE TRIGGER POINTS
 * 
 * 📋 GUIA PARA OPERADORES:
 * ========================
 * 
 * Este arquivo controla como o sistema gera trigger points (TPs) ao redor de POIs.
 * 
 * 🔧 COMO USAR:
 * - Modifique os valores nas configurações abaixo
 * - Use as configurações pré-definidas: 'default', 'conservative', 'aggressive', 'landmark'
 * - Teste mudanças em ambiente de desenvolvimento primeiro
 * 
 * ⚠️  CUIDADOS:
 * - Valores muito altos podem gerar muitos TPs (lentidão)
 * - Valores muito baixos podem gerar poucos TPs (cobertura insuficiente)
 * - Sempre teste após mudanças
 * 
 * 📊 CONFIGURAÇÕES DISPONÍVEIS:
 * - DEFAULT: Configuração balanceada para uso geral
 * - CONSERVATIVE: Menos TPs, mais próximos (economia de recursos)
 * - AGGRESSIVE: Mais TPs, mais distantes (melhor cobertura)
 * - LANDMARK: Otimizada para POIs muito altos (torres, monumentos)
 */

// =====================================
// CONSTANTES REUTILIZÁVEIS
// =====================================

// 🔧 CONSTANTES CENTRALIZADAS (SSOT - Single Source of Truth)
// ============================================================
// Todas as constantes hardcoded do sistema devem estar aqui
// para facilitar manutenção e ajustes

export const TRIGGER_POINTS_CONSTANTS = {
  // 📏 DISTÂNCIAS E RAIOS
  distances: {
    // Distâncias mínimas e máximas
    minArea: 100, // Área mínima de boundary (m²)
    maxElementDistance: 100, // Distância máxima para elemento ser considerado parte da estrutura (m)
    minBoundaryRadius: 10, // Raio mínimo para boundary estimado (m)
    maxBoundaryRadius: 50, // Raio máximo para boundary estimado (m)
    
    // Distâncias para validação de proximidade
    veryCloseDistance: 30, // Distância muito próxima para validação (m)
    frontStreetDistance: 50, // Distância para considerar "front street" (m) - reduzido de 75m
    veryCloseTPDistance: 25, // Distância muito próxima para TP (m)
    
    // Distâncias para auto-aprovação em canyons urbanos
    urbanCanyonAutoApprovalMin: 1, // Distância mínima para auto-aprovação em canyon (m)
    urbanCanyonAutoApprovalMax: 60, // Distância máxima para auto-aprovação em canyon (m)
    
    // Distâncias para análise de obstruções
    obstructionAnalysisRadius: 500, // Raio para análise de obstruções (m)
    lineOfSightSampleDistance: 50, // Distância entre pontos de amostragem (m)
    canyonAnalysisDistance: 100, // Distância para análise de canyon urbano (m)
    
    // Distâncias para ruas virtuais
    virtualStreetMinDistance: 50, // Distância mínima para ruas virtuais (m)
    virtualStreetBoundaryOffset: 0.3, // Offset do boundary para ruas virtuais (30%)
    
    // Distâncias para ruas reais criadas dinamicamente
    realStreetBoundaryOffset: 5, // Distância da rua real ao boundary (m) - mínimo absoluto para permitir ruas próximas
    realStreetValidationMargin: 1, // Margem de validação para pontos fora do boundary (m) - mínimo absoluto para ruas reais
    
    // Validação de TPs em ruas
    requireTPsOnStreets: true, // Garantir que TPs sejam apenas em ruas reais
    maxDistanceFromStreet: 20, // Distância máxima de um TP para uma rua real (m)
    
    // Distâncias para análise de altura
    surroundingHeightsRadius: 800, // Raio base para análise de altura do entorno (m) - aumentado de 500m
    surroundingHeightsRadiusMax: 1500, // Raio máximo para POIs muito altos (m)
    heightAnalysisTimeout: 30000, // Timeout para análise de altura (ms)
  },

  // ⏱️ TIMEOUTS E LIMITES DE TEMPO
  timeouts: {
    // Timeouts para queries OSM
    osmQueryShort: 10, // Timeout curto para queries simples (s)
    osmQueryMedium: 15, // Timeout médio para queries padrão (s)
    osmQueryLong: 30, // Timeout longo para queries complexas (s)
    osmQueryVeryLong: 60, // Timeout muito longo para queries pesadas (s)
    osmQueryExtreme: 90, // Timeout extremo para queries muito pesadas (s)
    osmQueryMax: 200, // Timeout máximo para queries críticas (s) - AUMENTADO para qualidade
    
    // Timeouts para APIs externas
    googleAPITimeout: 10000, // Timeout para APIs do Google (ms)
    googleAPIRetries: 3, // Número de tentativas para APIs do Google
  },

  // 📊 SCORES E CONFIDENCE
  scores: {
    // Scores de confiança
    minConfidence: 0.2, // Confiança mínima para aceitar candidato
    lowConfidence: 0.3, // Confiança baixa
    mediumConfidence: 0.5, // Confiança média
    highConfidence: 0.7, // Confiança alta
    veryHighConfidence: 0.9, // Confiança muito alta
    
    // Scores de qualidade
    minQuality: 0.3, // Qualidade mínima
    mediumQuality: 0.5, // Qualidade média
    highQuality: 0.8, // Qualidade alta
    maxQuality: 1.0, // Qualidade máxima
    
    // Scores de validação
    minVisibilityConfidence: 0.4, // Confiança mínima para visibilidade
    minVisibilityPercentage: 20, // Percentual mínimo de boundary visível
    streetViewConfidence: 0.7, // Confiança para Street View
    buildingsConfidence: 0.6, // Confiança para análise de prédios
    elevationConfidence: 0.5, // Confiança para análise de elevação
  },

  // 🔢 PROPORÇÕES E MULTIPLICADORES
  ratios: {
    // Proporções para cálculo de raio
    heightMultiplier: 6, // Multiplicador de altura para raio (6m por metro)
    heightMultiplierMax: 300, // Máximo do multiplicador de altura (m)
    elevationPenalty: 3, // Penalidade por elevação baixa (3m por metro)
    elevationPenaltyMin: 150, // Mínimo após penalidade de elevação (m)
    
    // Proporções para boundary
    boundaryRadiusMultiplier: 0.5, // Multiplicador do raio do boundary (50%)
    boundaryRadiusMin: 100, // Raio mínimo do boundary (m)
    
    // Proporções para análise de densidade
    buildingDensityThreshold: 50, // Threshold de densidade de prédios (prédios/km²)
    buildingDensityBonus: 0.2, // Bonus por baixa densidade (20%)
    
    // Proporções para validação
    visibilityBonus: 0.2, // Bonus por visibilidade (20%)
    frontStreetBonus: 0.05, // Bonus por front street (5%)
    frontStreetConfidenceBonus: 0.03, // Bonus de confiança por front street (3%)
  },

  // 🏗️ LIMITES E THRESHOLDS
  limits: {
    // Limites de altura
    extremelyTallHeight: 100, // Altura para POI extremamente alto (m)
    veryTallHeight: 50, // Altura para POI muito alto (m)
    tallHeight: 20, // Altura para POI alto (m)
    mediumHeight: 15, // Altura para POI médio (m)
    lowHeight: 10, // Altura para POI baixo (m)
    
    // Limites de elevação
    highElevation: 1000, // Elevação alta (m)
    mediumElevation: 400, // Elevação média (m)
    lowElevation: 50, // Elevação baixa (m)
    
    // Limites de área
    veryLargeArea: 500000, // Área muito grande (m²)
    largeArea: 100000, // Área grande (m²)
    mediumArea: 50000, // Área média (m²)
    smallArea: 10000, // Área pequena (m²)
    
    // Limites de densidade urbana
    veryDenseDensity: 500, // Densidade muito alta (prédios/km²)
    denseDensity: 200, // Densidade alta (prédios/km²)
    mediumDensity: 80, // Densidade média (prédios/km²)
    lowDensity: 20, // Densidade baixa (prédios/km²)
    
    // Limites de distância entre TPs
    minTPDistance: 40, // Distância mínima entre TPs (m) - aumentado para evitar sobreposição
    maxTPDistance: 100, // Distância máxima entre TPs (m) - aumentado de 30m
    
    // Limites de análise
    maxSamplePoints: 3, // Máximo de pontos de amostragem
    minSamplePoints: 1, // Mínimo de pontos de amostragem
    samplePointDistance: 100, // Distância entre pontos de amostragem (m)
  },

  // 🎯 CONFIGURAÇÕES DE VALIDAÇÃO
  validation: {
    // Validação de ângulo
    onewayAngleThreshold: 90, // Threshold de ângulo para validação de oneway (graus)
    onewayAngleMax: 270, // Ângulo máximo para validação de oneway (graus)
    
    // Validação de padrão de ruas
    gridAngleVariance: 10, // Variância de ângulo para padrão grid (graus)
    gridBlockSize: 150, // Tamanho de bloco para padrão grid (m)
    organicAngleVariance: 30, // Variância de ângulo para padrão orgânico (graus)
    organicBlockSize: 100, // Tamanho de bloco para padrão orgânico (m)
    
    // Validação de confiança OSM
    osmNameBonus: 0.2, // Bonus por nome no OSM
    osmProximityBonus: 0.1, // Bonus por proximidade no OSM
    osmCategoryBonus: 0.05, // Bonus por categoria no OSM
    osmRelationBonus: 0.1, // Bonus por relação no OSM
    osmWayBonus: 0.05, // Bonus por way no OSM
    osmBuildingBonus: 0.05, // Bonus por building no OSM
    osmMaxConfidence: 0.9, // Confiança máxima do OSM
  },

  // 🏗️ CONFIGURAÇÕES DE ALTURA E ELEVAÇÃO
  height: {
    // Thresholds de altura para classificação
    extremelyTallThreshold: 100, // Altura para POI extremamente alto (m)
    veryTallThreshold: 50, // Altura para POI muito alto (m)
    tallThreshold: 20, // Altura para POI alto (m)
    highPOIThreshold: 30, // Altura para POI alto (m)
    // Thresholds de elevação
    highElevationThreshold: 100, // Diferença de elevação para landmark alto (m)
    veryHighElevationThreshold: 1000, // Elevação muito alta (m)
    highElevationThreshold2: 400, // Elevação alta (m)
    // Área thresholds
    veryLargeAreaThreshold: 1000000, // Área muito grande (m²) - 1km²
    largeAreaThreshold: 500000, // Área grande (m²) - 0.5km²
  },

  // 🏢 CONFIGURAÇÕES DE OBSTRUÇÕES
  obstructions: {
    // Distâncias de busca
    baseSearchRadius: 1000, // Raio base de busca (m)
    maxSearchRadius: 10000, // Raio máximo de busca (m)
    veryDenseRadius: 1000, // Raio para área muito densa (m)
    denseRadius: 1500, // Raio para área densa (m)
    mediumRadius: 2500, // Raio para área média (m)
    lowRadius: 5000, // Raio para área baixa (m)
    ruralRadius: 10000, // Raio para área rural (m)
    // Cache
    cacheDuration: 30, // Duração do cache (minutos)
    // Buffer e distâncias
    bufferDistance: 100, // Distância de buffer (m)
    farDistanceThreshold: 300, // Distância considerada longe (m)
    closeDistanceThreshold: 50, // Distância considerada próxima (m)
    veryCloseDistanceThreshold: 10, // Distância muito próxima (m)
    // Alturas de bloqueio
    mediumBuildingHeight: 8, // Altura de prédio médio (m)
    buildingBlockingRatio: 0.6, // Proporção de altura para bloqueio (60%)
    // Raio de busca para buildings
    buildingSearchRadius: 150, // Raio de busca para buildings (m)
    denseZoneSearchRadius: 300, // Raio de busca em zona densa (m)
    normalZoneSearchRadius: 200, // Raio de busca em zona normal (m)
    // Multiplicadores de elevação
    elevationMultiplier: 200, // Multiplicador para cálculo de raio por elevação
    maxElevationRadius: 8000, // Raio máximo por elevação (m)
  },

  // 📊 CONFIGURAÇÕES DE PROCESSAMENTO
  processing: {
    // Batch processing
    batchSize: 5, // Tamanho do lote para processamento
    // Multiplicadores
    visibilityBonusMultiplier: 0.5, // Multiplicador para bônus de visibilidade
    // Thresholds de obstrução
    obstructionPenaltyMin: 0.2, // Penalty mínimo por obstrução
    // Distâncias de validação
    buildingBetweenThreshold: 0.9, // Threshold para building entre TP e boundary (90%)
  },

  // 🌍 CONSTANTES GEOGRÁFICAS (SSOT)
  geographic: {
    metersPerDegree: 111320, // 1 grau ≈ 111,320 metros (constante global)
    earthRadiusKm: 6371, // Raio da Terra em km
    defaultSearchRadius: 500, // Raio padrão de busca em metros
  }
};

// =====================================
// 🎯 CONFIGURAÇÕES POR GRUPO DE POI
// =====================================
/**
 * Sistema de Classificação em 4 Grupos Universais
 * ================================================
 * 
 * Baseado APENAS em características físicas:
 * - HIGH: Alta elevação + qualquer altura (visível de longe)
 * - MEDIUM: Baixa elevação + estrutura alta (torres, edifícios isolados)
 * - CANYON: Baixa elevação + estrutura média + área densa (visibilidade restrita)
 * - FLAT: Baixa elevação + estrutura baixa (visibilidade local)
 */

export enum POIGroup {
  HIGH = 'high',
  MEDIUM = 'medium',
  CANYON = 'canyon',
  FLAT = 'flat'
}

export interface POIGroupConfig {
  classification: {
    elevationDiffMin?: number;
    elevationDiffMax?: number;
    heightMin?: number;
    heightMax?: number;
    densityMin?: 'very_dense' | 'dense' | 'medium' | 'low' | 'rural';
    areaMin?: number;
    areaMax?: number;
  };
  searchRadius: {
    formula?: string;
    fixed?: number;
    min?: number;
    max?: number;
  };
  maxTriggerPoints: number;
  minDistanceBetweenTPs: number;
  visibilityThreshold: number;
  strategy: 'circular' | 'linear' | 'standard';
  streetPriority: string[];
  blockStreets: string[];
  specialRules?: {
    prioritizeFrontStreet?: boolean;
    rigorousVisibilityCheck?: boolean;
  };
}

export const GROUP_CONFIGS: Record<POIGroup, POIGroupConfig> = {
  // 🏔️ HIGH: Alta elevação + qualquer altura
  // Exemplos: Pico do Jaraguá, Cristo Redentor, Pão de Açúcar
  // Lógica: Se está em local alto, é visível de longe independente da altura
  [POIGroup.HIGH]: {
    classification: {
      elevationDiffMin: 150,  // >150m diferença de elevação
      heightMin: 0,           // Qualquer altura de estrutura
    },
    searchRadius: {
      formula: 'sqrt(elevationDiff) * 200',  // Fórmula: √(elevação) × 200
      min: 3000,   // Mínimo 3km
      max: 15000   // Máximo 15km
    },
    maxTriggerPoints: 50,
    minDistanceBetweenTPs: 100,
    visibilityThreshold: 0.3,  // Menos restritivo (visível de longe)
    strategy: 'circular',
    streetPriority: ['motorway', 'trunk', 'primary'],  // Apenas grandes vias
    blockStreets: ['residential', 'unclassified', 'tertiary', 'secondary']  // Bloquear ruas locais
  },
  
  // 🏗️ MEDIUM: Baixa elevação + estrutura alta (>50m)
  // Exemplos: Torre Eiffel, Sagrada Família, Edifício Itália (se isolado)
  // Lógica: POI alto mas no nível do chão, visível de média distância
  [POIGroup.MEDIUM]: {
    classification: {
      elevationDiffMax: 150,  // Elevação baixa (<150m)
      heightMin: 50           // Estrutura alta (>50m)
    },
    searchRadius: {
      formula: 'height * 15',  // Fórmula: altura × 15
      min: 750,    // Mínimo 750m
      max: 5000    // Máximo 5km
    },
    maxTriggerPoints: 35,
    minDistanceBetweenTPs: 80,
    visibilityThreshold: 0.4,  // Moderadamente restritivo
    strategy: 'circular',
    streetPriority: ['motorway', 'trunk', 'primary', 'secondary'],
    blockStreets: []  // Não bloqueia nenhuma rua
  },
  
  // 🏙️ CANYON: Baixa elevação + estrutura média (10-50m) + área densa
  // Exemplos: Edifício Copan, prédios em centros urbanos densos
  // Lógica: POI médio cercado por outros prédios similares, visibilidade muito limitada
  [POIGroup.CANYON]: {
    classification: {
      elevationDiffMax: 150,  // Elevação baixa
      heightMin: 10,          // Estrutura média (10-50m)
      heightMax: 50,
      densityMin: 'dense',    // Área densa ou muito densa
      areaMax: 50000          // Área pequena/média
    },
    searchRadius: {
      fixed: 75  // Raio fixo de 300m (muito limitado)
    },
    maxTriggerPoints: 15,
    minDistanceBetweenTPs: 40,
    visibilityThreshold: 0.6,  // Muito restritivo (muitas obstruções)
    strategy: 'linear',
    streetPriority: ['primary', 'secondary', 'tertiary'],  // Ruas locais
    blockStreets: [],
    specialRules: {
      prioritizeFrontStreet: true,      // Priorizar rua da frente
      rigorousVisibilityCheck: true     // Validação rigorosa de visibilidade
    }
  },
  
  // 🏞️ FLAT: Baixa elevação + estrutura baixa (<10m) OU estrutura média em área não densa
  // Exemplos: Parque Ibirapuera, praças, monumentos baixos, estádios
  // Lógica: POI baixo ou médio sem obstruções, visibilidade limitada à vizinhança
  [POIGroup.FLAT]: {
    classification: {
      elevationDiffMax: 50,   // Elevação muito baixa (<=50m)
      heightMax: 10,          // Estrutura baixa (<10m) OU área grande
      areaMin: 10000          // OU área grande (parques, etc.)
    },
    searchRadius: {
      fixed: 180  // Raio fixo de 150m (limitado ao entorno)
    },
    maxTriggerPoints: 40,
    minDistanceBetweenTPs: 40,
    visibilityThreshold: 0.5,  // Moderado
    strategy: 'standard',
    streetPriority: ['motorway', 'trunk','primary', 'secondary', 'tertiary', 'residential'],
    blockStreets: []
  }
};

// Configuração de distribuição de distâncias (compartilhada)
const SHARED_DISTANCE_DISTRIBUTION = {
  // Estratégia circular para alta elevação
  circular: {
    inner: 300,        // Círculo interno - próximo
    near_medium: 800,  // Círculo próximo-médio  
    medium: 1500,      // Círculo médio
    medium_far: 2500,  // Círculo médio-distante
    far: 4000,         // Círculo distante
    max: 8000          // Círculo máximo (aumentado de 6km para 8km)
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
};

// 🔧 FUNÇÕES AUXILIARES (para desenvolvedores)
// =============================================

/**
 * Cria configuração de densidade urbana
 * @param very_dense Valor para áreas muito densas (centro da cidade)
 * @param dense Valor para áreas densas (bairros centrais)
 * @param medium Valor para áreas médias (subúrbios)
 * @param low Valor para áreas baixas (periferia)
 * @param rural Valor para áreas rurais (campo)
 */
const createDensityConfig = (
  very_dense: number, 
  dense: number, 
  medium: number, 
  low: number, 
  rural: number
) => ({
  very_dense,
  dense,
  medium,
  low,
  rural
});

/**
 * Cria limites mínimo e máximo
 * @param min Valor mínimo permitido
 * @param max Valor máximo permitido
 */
const createLimits = (min: number, max: number) => ({ min, max });

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
      // Auto-aprovação para canyons urbanos
      urbanCanyon: {
        minDistance: number; // Distância mínima para auto-aprovação em canyon (m)
        maxDistance: number; // Distância máxima para auto-aprovação em canyon (m)
        enabled: boolean; // Habilitar auto-aprovação para canyons urbanos
      };
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
    
    // 🏔️ NOVO: Configurações específicas para POIs de alta elevação
    highElevationScores: {
      motorway: number;
      trunk: number;
      primary: number;
      secondary: number;
      tertiary: number;
      residential: number;
      unclassified: number;
    };
    
    // 🚫 NOVO: Tipos de rua bloqueados para POIs de alta elevação
    blockedStreetTypes: {
      highElevation: string[];
    };
    
    // Bonus por características
    bonuses: {
      frontStreet: number;
      highVisibility: number;
      optimalDistance: number;
      highElevationHighway: number; // 🏔️ NOVO: Bonus para highways em POIs de alta elevação
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
/**
 * 🎯 CONFIGURAÇÃO PADRÃO - BALANCEADA
 * ====================================
 * 
 * Esta é a configuração recomendada para uso geral.
 * Gera uma quantidade equilibrada de TPs com boa cobertura.
 */
export const DEFAULT_TRIGGER_POINTS_CONFIG: TriggerPointsConfig = {
  // 🔍 RAIO DE BUSCA - Define quão longe o sistema procura por ruas
  searchRadius: {
    // Raio base em metros para cada tipo de área urbana
    baseRadius: createDensityConfig(150, 200, 300, 400, 500), // metros
    
    // 📏 MULTIPLICADORES POR ALTURA - POIs altos têm raio maior
    heightMultipliers: {
      extremely_tall: { // POIs >100m (torres, arranha-céus)
        multiplier: 3, // 3m raio por metro de diferença
        maxRadius: 800, // máximo 800m
        minRadius: 200  // mínimo 200m
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
    
    limits: createLimits(150, 8000) // Aumentado de 5km para 8km
  },

  // 🎯 LIMITE DE TRIGGER POINTS - Controla quantos TPs são gerados
  maxTriggerPoints: {
    basePercentage: 0.20, // 20% dos candidatos encontrados (aumentado para parques grandes)
    
    heightAdjustments: {
      extremely_tall: {
        percentage: 0.20, // 20% dos candidatos (reduzido de 35% para qualidade)
        maxLimit: 150 // Reduzido de 300 para qualidade
      },
      very_tall: {
        percentage: 0.10, // 10% dos candidatos (aumentado de 6%)
        maxLimit: 150 // Aumentado de 80
      },
      tall: {
        percentage: 0.08, // 8% dos candidatos (aumentado de 5%)
        maxLimit: 100 // Aumentado de 70
      },
      medium: {
        percentage: 0.05, // 5% dos candidatos (aumentado de 3%)
        maxLimit: 80 // Aumentado de 50
      }
    },
    
    areaAdjustments: {
      very_large: {
        percentage: 0.15, // 15% dos candidatos (aumentado de 7% para parques grandes)
        maxLimit: 150 // Aumentado de 100 para 150
      },
      large: {
        percentage: 0.12, // 12% dos candidatos (aumentado de 6%)
        maxLimit: 120 // Aumentado de 80 para 120
      }
    },
    
    elevationAdjustments: {
      high_landmark: {
        percentage: 0.08, // 8% dos candidatos
        maxLimit: 120
      }
    },
    
    limits: createLimits(10, 200) // Aumentado mínimo para POIs grandes
  },

  // 📐 DISTÂNCIA MÍNIMA ENTRE TPs - Evita TPs muito próximos
  minDistance: {
    baseDistance: createDensityConfig(35, 40, 45, 50, 55), // metros (aumentado para melhor qualidade)
    
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
    
    limits: createLimits(30, 100)
  },

  // 👁️ CONFIGURAÇÕES DE VISIBILIDADE - Controla validação de TPs
  visibility: {
    autoApproval: {
      frontStreetDistance: 60, // TPs <60m do boundary = auto-aprovado (reduzido de 75m para qualidade)
      veryCloseDistance: 25, // TPs <25m do POI = front street (reduzido de 30m para qualidade)
      // NOVO: Auto-aprovação para canyons urbanos
      urbanCanyon: {
        minDistance: 1, // Distância mínima para auto-aprovação em canyon (m)
        maxDistance: 60, // Distância máxima para auto-aprovação em canyon (m)
        enabled: true // Habilitar auto-aprovação para canyons urbanos
      }
    },
    
    multipliers: {
      estimatedVisibilityRate: 95, // 95% taxa estimada de sucesso (aumentado para POIs FLAT)
      obstructionPenalty: {
        baseDensity: 80, // Densidade média estimada (reduzido para ser menos restritivo)
        maxDensity: 1000 // Densidade máxima para cálculo (aumentado para ser menos restritivo)
      }
    }
  },

  // Configurações de distribuição de distâncias (compartilhada)
  distanceDistribution: SHARED_DISTANCE_DISTRIBUTION,

  // ⭐ CONFIGURAÇÕES DE QUALIDADE - Pontuação por tipo de rua
  quality: {
    streetTypeScores: {
      motorway: 0.9,    // Autoestradas (melhor qualidade)
      trunk: 0.8,       // Vias principais
      primary: 0.7,     // Ruas primárias
      secondary: 0.6,   // Ruas secundárias
      tertiary: 0.5,    // Ruas terciárias
      residential: 0.4, // Ruas residenciais
      unclassified: 0.3 // Ruas não classificadas
    },
    
    // 🏔️ NOVO: Configurações específicas para POIs de alta elevação
    highElevationScores: {
      motorway: 1.0,    // Máxima prioridade para autoestradas em picos
      trunk: 0.95,      // Alta prioridade para vias principais
      primary: 0.85,    // Boa prioridade para rodovias principais
      secondary: 0.0,   // 🚫 BLOQUEADAS para POIs altos
      tertiary: 0.0,    // 🚫 BLOQUEADAS para POIs altos
      residential: 0.0, // 🚫 BLOQUEADAS para POIs altos
      unclassified: 0.0 // 🚫 BLOQUEADAS para POIs altos
    },
    
    // 🚫 NOVO: Tipos de rua bloqueados para POIs de alta elevação
    blockedStreetTypes: {
      highElevation: ['residential', 'unclassified', 'tertiary', 'secondary']
    },
    
    bonuses: {
      frontStreet: 0.2,
      highVisibility: 0.3,
      optimalDistance: 0.1,
      // 🏔️ NOVO: Bonus para highways em POIs de alta elevação
      highElevationHighway: 0.15
    }
  }
};

// =====================================
// CONFIGURAÇÕES PRÉ-DEFINIDAS
// =====================================

/**
 * 🛡️ CONFIGURAÇÃO CONSERVADORA - ECONOMIA DE RECURSOS
 * ====================================================
 * 
 * Gera menos TPs, mais próximos ao POI.
 * Ideal para:
 * - Economia de recursos computacionais
 * - POIs em áreas muito densas
 * - Testes rápidos
 * 
 * ⚠️ Pode resultar em cobertura insuficiente para POIs grandes.
 */
export const CONSERVATIVE_CONFIG: TriggerPointsConfig = {
  ...DEFAULT_TRIGGER_POINTS_CONFIG,
  searchRadius: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.searchRadius,
    baseRadius: createDensityConfig(100, 150, 200, 300, 400), // metros (mais conservador)
    limits: createLimits(100, 3000)
  },
  maxTriggerPoints: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.maxTriggerPoints,
    basePercentage: 0.02, // 2% dos candidatos
    limits: createLimits(3, 50)
  }
  // distanceDistribution é herdado automaticamente do DEFAULT
};

/**
 * 🚀 CONFIGURAÇÃO AGRESSIVA - MÁXIMA COBERTURA
 * ============================================
 * 
 * Gera mais TPs, mais distantes do POI.
 * Ideal para:
 * - Máxima cobertura de área
 * - POIs muito grandes (parques, complexos)
 * - Landmarks importantes
 * 
 * ⚠️ Pode gerar muitos TPs (lentidão) e consumir mais recursos.
 */
export const AGGRESSIVE_CONFIG: TriggerPointsConfig = {
  ...DEFAULT_TRIGGER_POINTS_CONFIG,
  searchRadius: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.searchRadius,
    baseRadius: createDensityConfig(200, 300, 400, 500, 600), // metros (mais agressivo)
    limits: createLimits(200, 10000) // Aumentado de 8km para 10km
  },
  maxTriggerPoints: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.maxTriggerPoints,
    basePercentage: 0.05, // 5% dos candidatos
    limits: createLimits(5, 200)
  }
  // distanceDistribution é herdado automaticamente do DEFAULT
};

/**
 * 🏗️ CONFIGURAÇÃO LANDMARK - POIs MUITO ALTOS
 * ============================================
 * 
 * Otimizada para POIs muito altos (torres, monumentos, arranha-céus).
 * Características:
 * - Raios de busca maiores
 * - Mais TPs para POIs altos
 * - Multiplicadores otimizados para altura
 * 
 * Ideal para:
 * - Torres de telecomunicações
 * - Monumentos históricos
 * - Arranha-céus
 * - Pontes altas
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
    limits: createLimits(200, 12000) // Aumentado de 10km para 12km
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
    limits: createLimits(5, 200)
  }
  // distanceDistribution é herdado automaticamente do DEFAULT
};

// =====================================
// FUNÇÃO PARA CARREGAR CONFIGURAÇÃO
// =====================================

/**
 * 🔧 FUNÇÃO PARA CARREGAR CONFIGURAÇÃO
 * =====================================
 * 
 * @param configName Nome da configuração ou configuração customizada
 * @returns Configuração de trigger points
 * 
 * 📋 CONFIGURAÇÕES DISPONÍVEIS:
 * - 'default': Configuração balanceada (recomendada)
 * - 'conservative': Menos TPs, mais próximos
 * - 'aggressive': Mais TPs, mais distantes  
 * - 'landmark': Otimizada para POIs muito altos
 * 
 * 💡 EXEMPLO DE USO:
 * ```typescript
 * const config = loadTriggerPointsConfig('landmark');
 * ```
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

// =====================================
// 📚 GUIA RÁPIDO PARA OPERADORES
// =====================================

/**
 * 🎯 GUIA RÁPIDO DE CONFIGURAÇÃO
 * ===============================
 * 
 * 🔧 COMO ALTERAR CONFIGURAÇÕES:
 * 1. Escolha uma configuração pré-definida (recomendado)
 * 2. Ou modifique os valores na configuração padrão
 * 3. Teste sempre em ambiente de desenvolvimento
 * 
 * 📊 QUANDO USAR CADA CONFIGURAÇÃO:
 * 
 * 🛡️ CONSERVATIVE:
 * - POIs pequenos em áreas densas
 * - Economia de recursos
 * - Testes rápidos
 * 
 * 🎯 DEFAULT (RECOMENDADO):
 * - Uso geral
 * - Maioria dos POIs
 * - Equilíbrio entre cobertura e performance
 * 
 * 🚀 AGGRESSIVE:
 * - POIs muito grandes (parques, complexos)
 * - Máxima cobertura necessária
 * - Landmarks importantes
 * 
 * 🏗️ LANDMARK:
 * - Torres, monumentos, arranha-céus
 * - POIs >100m de altura
 * - Pontes altas
 * 
 * ⚠️ CUIDADOS:
 * - Valores muito altos = lentidão
 * - Valores muito baixos = cobertura insuficiente
 * - Sempre teste após mudanças
 * 
 * 🔍 PRINCIPAIS PARÂMETROS:
 * - baseRadius: Raio de busca por ruas (metros)
 * - basePercentage: % de candidatos que viram TPs
 * - baseDistance: Distância mínima entre TPs (metros)
 * - limits: Limites mínimo e máximo
 */
