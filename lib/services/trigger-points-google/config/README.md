# Configuração Centralizada de Trigger Points

Este diretório contém todas as configurações ajustáveis para o sistema de trigger points, permitindo que você teste diferentes parâmetros sem modificar o código.

## 📁 Arquivos

- `trigger-points-config.ts` - Configurações principais
- `example-usage.ts` - Exemplos de uso e configurações personalizadas
- `README.md` - Este arquivo de documentação

## 🚀 Como Usar

### 1. Configurações Pré-definidas

```typescript
import { loadTriggerPointsConfig } from './trigger-points-config';

// Configuração padrão
const defaultConfig = loadTriggerPointsConfig('default');

// Configuração conservadora (menos TPs, mais próximos)
const conservativeConfig = loadTriggerPointsConfig('conservative');

// Configuração agressiva (mais TPs, mais distantes)
const aggressiveConfig = loadTriggerPointsConfig('aggressive');

// Configuração para landmarks (POIs muito altos)
const landmarkConfig = loadTriggerPointsConfig('landmark');
```

### 2. Configuração Personalizada

```typescript
import { DEFAULT_TRIGGER_POINTS_CONFIG, TriggerPointsConfig } from './trigger-points-config';

const customConfig: TriggerPointsConfig = {
  ...DEFAULT_TRIGGER_POINTS_CONFIG,
  
  // Aumentar raio de busca para POIs altos
  searchRadius: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.searchRadius,
    heightMultipliers: {
      extremely_tall: {
        multiplier: 5, // 5m raio por metro de diferença
        maxRadius: 1000, // máximo 1km
        minRadius: 250 // mínimo 250m
      }
    }
  }
};
```

## ⚙️ Parâmetros Configuráveis

### 🔍 Raio de Busca (`searchRadius`)

Controla até onde o sistema busca por ruas para colocar trigger points.

```typescript
searchRadius: {
  baseRadius: {
    very_dense: 150, // Áreas muito densas (centro da cidade)
    dense: 200,      // Áreas densas
    medium: 300,     // Áreas médias
    low: 400,        // Áreas com poucos prédios
    rural: 500       // Áreas rurais
  },
  
  heightMultipliers: {
    extremely_tall: {
      multiplier: 3,    // 3m raio por metro de diferença de altura
      maxRadius: 800,   // Máximo 800m
      minRadius: 200    // Mínimo 200m
    }
  }
}
```

### 🎯 Limite de Trigger Points (`maxTriggerPoints`)

Controla quantos trigger points o sistema pode gerar.

```typescript
maxTriggerPoints: {
  basePercentage: 0.03, // 3% dos candidatos
  
  heightAdjustments: {
    extremely_tall: {
      percentage: 0.08, // 8% dos candidatos
      maxLimit: 120     // Máximo 120 TPs
    }
  }
}
```

### 📏 Distância Mínima (`minDistance`)

Controla a distância mínima entre trigger points.

```typescript
minDistance: {
  baseDistance: {
    very_dense: 40, // 40m em áreas muito densas
    dense: 45,      // 45m em áreas densas
    medium: 50,     // 50m em áreas médias
    low: 60,        // 60m em áreas com poucos prédios
    rural: 70       // 70m em áreas rurais
  }
}
```

## 🧪 Exemplos de Teste

### Teste 1: Aumentar Raio para POIs Altos

```typescript
const config = {
  ...DEFAULT_TRIGGER_POINTS_CONFIG,
  searchRadius: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.searchRadius,
    heightMultipliers: {
      extremely_tall: {
        multiplier: 5, // Aumentar de 3 para 5
        maxRadius: 1000, // Aumentar de 800 para 1000
        minRadius: 250 // Aumentar de 200 para 250
      }
    }
  }
};
```

### Teste 2: Mais Trigger Points para Landmarks

```typescript
const config = {
  ...DEFAULT_TRIGGER_POINTS_CONFIG,
  maxTriggerPoints: {
    ...DEFAULT_TRIGGER_POINTS_CONFIG.maxTriggerPoints,
    heightAdjustments: {
      extremely_tall: {
        percentage: 0.10, // Aumentar de 8% para 10%
        maxLimit: 150 // Aumentar de 120 para 150
      }
    }
  }
};
```

### Teste 3: Configuração para Cidades Europeias

```typescript
const europeanConfig = {
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
```

## 📊 Configurações Pré-definidas

### `default` - Configuração Padrão
- Raio base: 150-500m
- TPs: 3-150
- Distância mínima: 40-70m

### `conservative` - Conservadora
- Raio base: 100-400m
- TPs: 3-50
- Distância mínima: 40-70m

### `aggressive` - Agressiva
- Raio base: 200-600m
- TPs: 5-200
- Distância mínima: 40-70m

### `landmark` - Para Landmarks
- Raio base: 200-1000m
- TPs: 5-200
- Distância mínima: 40-70m

## 🔧 Como Implementar

1. **Importe a configuração**:
   ```typescript
   import { loadTriggerPointsConfig } from './config/trigger-points-config';
   ```

2. **Carregue a configuração desejada**:
   ```typescript
   const config = loadTriggerPointsConfig('landmark');
   ```

3. **Passe para o sistema**:
   ```typescript
   const triggerPoints = await generateTriggerPoints(poiId, config);
   ```

## 🎯 Dicas de Ajuste

### Para POIs Altos (Igrejas, Monumentos)
- Aumente `heightMultipliers.extremely_tall.multiplier`
- Aumente `heightMultipliers.extremely_tall.maxRadius`
- Aumente `maxTriggerPoints.heightAdjustments.extremely_tall.percentage`

### Para POIs Pequenos (Restaurantes, Lojas)
- Diminua `baseRadius` para todas as densidades
- Diminua `basePercentage`
- Diminua `maxLimit`

### Para Áreas Muito Densas
- Diminua `baseRadius.very_dense`
- Diminua `baseDistance.very_dense`
- Aumente `basePercentage` para compensar

### Para Áreas Rurais
- Aumente `baseRadius.rural`
- Aumente `baseDistance.rural`
- Diminua `basePercentage`

## 🚨 Limites de Segurança

- **Raio mínimo**: 50m (evita TPs muito próximos)
- **Raio máximo**: 10km (evita busca excessiva)
- **TPs mínimos**: 2 (garante cobertura básica)
- **TPs máximos**: 200 (evita sobrecarga)

## 📈 Monitoramento

Para monitorar o impacto das mudanças:

1. **Logs de raio**: Verifique se o raio calculado está dentro do esperado
2. **Número de candidatos**: Mais candidatos = mais opções de TPs
3. **TPs finais**: Verifique se o número final está adequado
4. **Distâncias**: Verifique se as distâncias entre TPs estão corretas

## 🔄 Teste A/B

Para testar diferentes configurações:

```typescript
// Configuração A
const configA = loadTriggerPointsConfig('aggressive');

// Configuração B  
const configB = loadTriggerPointsConfig('conservative');

// Alternar baseado em critério
const config = poiId.endsWith('0') ? configA : configB;
```
