---
description: Análise e geração de Trigger Points para POIs individuais - lógica de visibilidade e obstruções
---

# 🎯 Trigger Points Single - Análise e Geração

Este workflow documenta a lógica de geração de Trigger Points considerando
obstruções visuais e contexto urbano.

## 📊 Lógica de Classificação de POIs

O sistema classifica POIs em **4 grupos universais** baseados em características
físicas:

| Grupo         | Descrição                               | Exemplo                                 | Raio de Busca |
| ------------- | --------------------------------------- | --------------------------------------- | ------------- |
| 🏔️ **HIGH**   | Alta elevação (>150m diff)              | Pico do Jaraguá, Cristo Redentor        | 3-15km        |
| 🏗️ **MEDIUM** | Estrutura alta (>50m) em área não-densa | Torre Eiffel, Edifício Itália isolado   | 750m-5km      |
| 🏙️ **CANYON** | Estrutura média em área DENSA           | Edifício Copan, prédios no centro de SP | 75m fixo      |
| 🏞️ **FLAT**   | Estrutura baixa ou área grande          | Parque Ibirapuera, praças               | 120m fixo     |

## 🏠 Constantes de Altura de Obstruções

### Casas/Sobrados (CONSTANTE FIXA)

- **Valor**: 6 metros
- **Uso**: Qualquer building tipo `house`, `detached`, `terrace`, etc.
- **Localização**: `TRIGGER_POINTS_CONSTANTS.obstructions.defaultHouseHeight`

### Prédios em Canyon Urbano (VARIÁVEL)

- **Lógica**: Em canyons urbanos, prédios vizinhos SEM altura conhecida assumem
  altura SIMILAR ao POI
- **Exemplo**: Copan tem 110m → prédios vizinhos também ~110m
- **Configurações**:
  - `TRIGGER_POINTS_CONSTANTS.obstructions.useCanyonNeighborHeight`: true/false
  - `TRIGGER_POINTS_CONSTANTS.obstructions.canyonHeightMultiplier`: 1.0 (mesma
    altura do POI)

### Altura Mínima para Bloqueio

- **Valor**: 3 metros
- **Uso**: Qualquer obstrução > 3m bloqueia visão de POI FLAT (0m altura)
- **Localização**: `TRIGGER_POINTS_CONSTANTS.obstructions.minBlockingHeight`

## 🚗 Cenário: Passageiro de Carro

A lógica considera a perspectiva de um passageiro dentro de um carro:

1. **Altura do observador**: ~1.2-1.5m (sentado)
2. **Linha de visão**: Do ponto do Trigger até o POI
3. **Obstruções detectadas**:
   - Buildings (casas, prédios)
   - Vegetação densa (bosques, florestas)
   - Barreiras (muros, paredes)
   - Elevação do terreno (morros entre TP e POI)

## 📍 Decisão de Colocação de Trigger Point (Análise Setorial)

O sistema utiliza uma análise por **Setores/Quadrantes** (N, S, E, W) baseada em
amostragem do boundary:

### Estratégia "Ver pelas Bordas"

- O sistema seleciona **5 pontos do boundary** do POI (distribuídos).
- Para cada candidato a TP, verifica a visibilidade para **TODOS** os 5 pontos.
- **Critério de Aprovação**:
  - Se **PELO MENOS 1 ponto** for visível → TP Aprovado (há uma fresta de
    visão).
  - Se **TODOS** os pontos forem bloqueados → TP Rejeitado (paredão).

### Cenário 1: POI FLAT (praça, parque)

- Se há **casa** (6m) bloqueando todos os 5 pontos → **BLOQUEIA**
- Geralmente bloqueado por qualquer construção > 3m

### Cenário 2: POI ALTO em CANYON URBANO (Copan)

- Prédios vizinhos sem altura conhecida assumem altura do POI.
- Exemplo: TP na Av. São Luís para o Copan (bloqueado por paredão de prédios).
  - Todos os 5 pontos do boundary do Copan estarão ocultos pelos prédios da
    frente.
  - Resultado: **BLOQUEADO (Setor S/SW)**
- Exemplo: TP na Av. Ipiranga (visão parcial).
  - Pelo menos 1 ou 2 pontos do boundary estarão visíveis pelas frestas.
  - Resultado: **APROVADO (Setor N/NE)**

### Cenário 3: POI ALTO em área não-densa

- Se building tem altura < 60% do POI → **NÃO BLOQUEIA** (pode ver por cima)
- Exemplo: POI de 50m, prédio de 20m → visão por cima → **APROVADO**

## 🔧 Arquivos Principais

| Arquivo                              | Responsabilidade                                     |
| ------------------------------------ | ---------------------------------------------------- |
| `config/trigger-points-config.ts`    | Constantes e configurações globais                   |
| `services/poi-classifier.service.ts` | Classificação em grupos (HIGH, MEDIUM, CANYON, FLAT) |
| `services/osm-data-fetcher.ts`       | Busca de dados do OSM (buildings, ruas, etc.)        |
| `analyzers/validator.ts`             | Validação de visibilidade e obstruções               |
| `analyzers/visibility-validator.ts`  | Análise de linha de visão                            |

## 🔄 Ajustando Configurações

Para ajustar as constantes:

```typescript
// Em config/trigger-points-config.ts

TRIGGER_POINTS_CONSTANTS = {
    obstructions: {
        // Altura padrão de casas (metros)
        defaultHouseHeight: 6,

        // Usar altura do POI para vizinhos em canyon?
        useCanyonNeighborHeight: true,

        // Multiplicador (1.0 = mesma altura)
        canyonHeightMultiplier: 1.0,

        // Altura mínima para bloquear POI FLAT
        minBlockingHeight: 3,
    },
};
```

## ✅ Checklist de Verificação

- [ ] POIs FLAT: TPs apenas em ruas adjacentes
- [ ] POIs CANYON: TPs apenas na rua da frente
- [ ] Casas bloqueiam POIs baixos (6m > 3m)
- [ ] Prédios em canyon assumem altura do POI
- [ ] Prédios menores que 60% do POI não bloqueiam
