# POI Filtering Rules - Documentação Técnica

## Visão Geral

Este documento descreve as regras de negócio implementadas nos scripts de
filtragem de POIs (Points of Interest) para o sistema Tuggi. O objetivo é
extrair apenas POIs com valor turístico real, removendo ruído como
estabelecimentos comerciais genéricos, órgãos burocráticos e infraestrutura.

## Arquivos Principais (SSOT)

- **`lib/shared/poi-filter.ts`** - **A FONTE ÚNICA DE VERDADE (SSOT)**. Contém
  toda a lógica do "Elite Filter" e blocklists sincronizadas.
- `scripts/refine-pbf-elite.ts` - Script principal para processamento de
  arquivos PBF (consome o SSOT).
- `lib/services/osm-importer-service.ts` - Serviço do CMS para importação manual
  (consome o SSOT).
- `supabase/functions/capture-pois/index.ts` - Edge Function para captura via
  Overpass (consome o SSOT via `_shared/poi-filter.ts`).

---

## Regras de Filtragem (FILTER_CONFIG)

### 1. GLOBAL_BLOCKLIST - Termos Proibidos Globalmente

POIs cujo nome contém qualquer destes termos são **removidos imediatamente**,
exceto se atingirem critérios de elite.

#### Órgãos Administrativos/Burocráticos

- `secretaria`, `departamento`, `divisão`, `serviço`, `secretaria de`
- `fundação casa`, `poupatempo`, `detran`, `cartório`, `banco`, `caixa`

#### Cadeias Comerciais e Infraestrutura

- `oxxo`, `7-eleven`, `smart fit`, `drogasil`, `farmácia`, `pharmacy`
- `academia`, `parking`, `estacionamento`, `office`, `business center`
- `edifício`, `condomínio`, `condominio`, `torre de`

#### Termos Genéricos com Exceções Inteligentes

- **`center` / `centro`**: Removidos por padrão comercial. **Exceção**: Mantidos
  se forem Marcos Famosos (Rockefeller Center, Lincoln Center) ou Atrações
  Culturais (Museus).
- **`horta`**: Removidos se locais. **Exceção**: Mantidos se forem jardins
  turísticos/famosos.
- **`shopping`**: Sempre removidos. **Exceção**: Apenas se possuírem Wikipedia
  própria (raro).

### 2. RELIGIOUS_BRANDS - Marcas Religiosas Genéricas

Igrejas de redes/franquias sem valor arquitetônico ou histórico monumental são
removidas:

- `universal do reino`, `igreja universal`, `assembléia de deus`,
  `reino de deus`, `testemunhas de jeová`, etc.

### 3. ACCOMMODATION_TYPES - Hospedagem

Removidos a menos que tenham **Fama Comprovada** (Wikipedia ou Historic):

- `hotel`, `motel`, `hostel`, `guest_house`.
- **Apartamentos**: Sempre removidos (uso residencial).

---

## Lógica de Filtragem (shouldFilterPOI)

### Indicadores de Fama (Elite Status)

Para ser mantido, um POI "comum" (como um hotel ou praça) deve possuir um dos
indicadores abaixo:

- **Wikipedia**: Presença da tag `wikipedia` no OSM.
- **Wikidata**: Presença da tag `wikidata` (ajuda a capturar marcos globais
  menos taggeados).
- **Historic**: Tag `historic` válida (monumentos, ruínas, castelos).
- **Heritage**: Marcação de patrimônio histórico.

### Ordem de Verificação

1. **Sem Nome** → Remover.
2. **Blacklist Global** → Remover (considerando exceções para Centros
   Culturais).
3. **Marcas Religiosas** → Remover se não famoso.
4. **Residências Privadas** → Remover se não for museu/famoso.
5. **Boundaries (Limites)**:
   - **Burocráticos** (Distritos de cartório, zonas postais) → Remover.
   - **Paróquias Históricas** (St Paul's Parish) → Manter se `isFamous`.
6. **Picos Naturais** → Remover se não tiver Wiki ou Tourism tag.
7. **Leisure (Parques/Praças)**:
   - Utilitário (Pistas, quadras, playgrounds) → Remover Sempre.
   - Praças Genéricas → Remover se não famosas.
   - Pontos Geométricos Simples (`Node`) → Remover se não famoso.
8. **Atrações/Arte**:
   - Faróis e Moinhos (`man_made=lighthouse/windmill`) → **Sempre Mantidos**.
   - Outras Artes/Mirantes → Remover se não famosos.
9. **Igrejas**: Manter Católicas/Adventistas monumetais, remover outras sem
   fama.
10. **Comércio/Serviços**: Remover tudo, exceto Mercados Municipais e Townhalls.
11. **Palavras Únicas**: Remover nomes de uma palavra (ex: "Tower") se não
    tiverem referência global.

---

## Resultados de Validação (Acurácia)

| Cidade           | Processados | Mantidos | Taxa de Filtro | Exemplo de Sucesso    |
| :--------------- | :---------- | :------- | :------------- | :-------------------- |
| **New York**     | 4,511       | 178      | 96.1%          | Rockefeller Center ✅ |
| **Paris**        | 10,217      | 322      | 96.8%          | Musée du Louvre ✅    |
| **Edinburgh**    | 15,997      | 295      | 98.2%          | Edinburgh Castle ✅   |
| **Atlanta**      | 14,091      | 56       | 99.6%          | Georgia Aquarium ✅   |
| **Buenos Aires** | 4,392       | 127      | 97.1%          | Teatro Colón ✅       |

---

## Como Executar

### Teste (Overpass API)

```bash
./scripts/test-overpass.ts [lat] [lon] [radius]
```

### Produção (PBF)

```bash
./scripts/filter-pbf-tourism.ts [arquivo.pbf]
```
