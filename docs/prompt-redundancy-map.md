# Mapa de Redundâncias do Prompt

## Visualização de Redundâncias por Categoria

### 1. Regra "Never Invent" (8 ocorrências)

```
┌─────────────────────────────────────────────────────────┐
│ non_negotiable_rules (1731)                            │
│ "NEVER invent, guess, estimate, or approximate dates"  │
└─────────────────────────────────────────────────────────┘
         │
         ├─→ date_handling (1747) "NOT explicitly stated"
         ├─→ date_handling (1760) "NEVER create approximations"
         ├─→ date_handling (1763) "over any form of date invention"
         ├─→ structure (1786) "NEVER approximate or estimate"
         ├─→ data_guardrails (1859) "Never invent facts"
         ├─→ planning (1929) "Did I avoid inventing?"
         └─→ verification (1941) "all omitted rather than invented"
```

**Ação**: Consolidar em 3 lugares estratégicos

---

### 2. Referência "DATA BLOCKS" (18 ocorrências)

```
┌─────────────────────────────────────────────────────────┐
│ non_negotiable_rules (1732)                            │
│ "Use ONLY information from DATA BLOCKS"                 │
└─────────────────────────────────────────────────────────┘
         │
         ├─→ goal (1740) "ONLY if dates exist in DATA BLOCKS"
         ├─→ date_handling (1747) "NOT explicitly stated in DATA BLOCKS"
         ├─→ date_handling (1748) "exact year in DATA BLOCKS"
         ├─→ date_handling (1755) "no explicit year in DATA BLOCKS"
         ├─→ location_verification (1769) "EXPLICITLY stated in DATA BLOCKS"
         ├─→ location_verification (1770) "confirmed in DATA BLOCKS"
         ├─→ structure (1778) "EXPLICITLY in DATA BLOCKS"
         ├─→ structure (1783) "EXPLICITLY stated in DATA BLOCKS"
         ├─→ style (1808) "explicitly stated in DATA BLOCKS"
         ├─→ style (1809) "confirmed in DATA BLOCKS"
         ├─→ reference_links_processing (1819) "even if not in other DATA BLOCKS"
         ├─→ data_guardrails (1844) "explicitly stated in DATA BLOCKS"
         ├─→ data_guardrails (1857) "not in DATA BLOCKS"
         ├─→ data_guardrails (1866) "available in DATA BLOCKS"
         ├─→ planning (1904) "Review all DATA BLOCKS"
         ├─→ planning (1913) "explicitly in DATA BLOCKS"
         ├─→ planning (1919) "explicitly stated in DATA BLOCKS"
         └─→ verification (1938) "explicitly stated in DATA BLOCKS"
```

**Ação**: Definir uma vez, depois usar "from sources" ou "from context"

---

### 3. Verificação de Localização (4 ocorrências)

```
┌─────────────────────────────────────────────────────────┐
│ non_negotiable_rules (1734)                             │
│ "Verify location match: Name in City, State"            │
└─────────────────────────────────────────────────────────┘
         │
         ├─→ location_verification (1767-1770) [SEÇÃO COMPLETA]
         │   - Use exact combination
         │   - Only facts from DATA BLOCKS
         │   - Discard if not confirmed
         │
         ├─→ planning (1920) "Does the location match exactly?"
         └─→ verification (1940) "Location verified: facts match"
```

**Ação**: Consolidar em location_verification, referenciar nas outras

---

### 4. Priorização de Fontes (3 seções)

```
┌─────────────────────────────────────────────────────────┐
│ reference_links_processing (1814-1822)                  │
│ - Reference links are HIGHEST PRIORITY                  │
│ - Extract all facts                                     │
│ - Prioritize over all except official website          │
└─────────────────────────────────────────────────────────┘
         │
         └─→ data_guardrails (1825-1868) [HIERARQUIA COMPLETA]
             - 10 níveis de prioridade
             - Sub-hierarquias
             - Verificações
             
         └─→ planning (1905-1909) "prioritize reference links"
```

**Ação**: Manter hierarquia completa em data_guardrails, simplificar outras

---

### 5. Regras de Datas (4 seções)

```
┌─────────────────────────────────────────────────────────┐
│ date_handling (1745-1764) [SEÇÃO COMPLETA]             │
│ - Critical rules                                        │
│ - Date calculation                                      │
│ - Conflict resolution                                   │
│ - Fallback                                              │
└─────────────────────────────────────────────────────────┘
         │
         ├─→ structure (1778) "if year is EXPLICITLY in DATA BLOCKS"
         ├─→ structure (1783) "ONLY mention dates EXPLICITLY stated"
         ├─→ structure (1786) "NEVER approximate or estimate"
         ├─→ style (1808) "Dates ONLY if explicitly stated"
         └─→ goal (1740) "ONLY if dates exist in DATA BLOCKS"
```

**Ação**: Manter todas as regras em date_handling, referenciar nas outras

---

### 6. Estrutura 4 Partes (4 seções)

```
┌─────────────────────────────────────────────────────────┐
│ structure (1773-1803) [DEFINIÇÃO COMPLETA]              │
│ 1. OPENING                                              │
│ 2. TIMELINE & SIGNIFICANCE                              │
│ 3. DISTINCTIVE DETAIL                                   │
│ 4. SENSORY/PRESENT MOMENT                               │
└─────────────────────────────────────────────────────────┘
         │
         ├─→ goal (1738-1742) [MENCIONA OS 4 ELEMENTOS]
         │   - Orients listener
         │   - Anchors in time
         │   - Shares curiosity
         │   - Ends with sensory cue
         │
         ├─→ planning (1911-1915) [REPETE A ESTRUTURA]
         │   - Opening
         │   - Timeline
         │   - Curiosity
         │   - Sensory closing
         │
         └─→ verification (1952) "Structure is complete (4 parts)"
```

**Ação**: Manter definição completa em structure, referenciar nas outras

---

### 7. Regras de Especificidade (3 seções)

```
┌─────────────────────────────────────────────────────────┐
│ specificity_requirement (1861-1867) [SEÇÃO COMPLETA]    │
│ - Avoid generic descriptions                            │
│ - Use specific facts                                    │
│ - Examples of what to avoid                             │
└─────────────────────────────────────────────────────────┘
         │
         ├─→ reference_links_processing (1821) "Avoid generic descriptions"
         └─→ data_guardrails (1858) "Never use generic knowledge"
```

**Ação**: Consolidar em specificity_requirement, referenciar nas outras

---

### 8. Verificação Final (2 seções)

```
┌─────────────────────────────────────────────────────────┐
│ planning (1917-1921) [PASSO 3: VERIFY]                  │
│ - Can I trace every fact?                               │
│ - Are all dates explicitly stated?                      │
│ - Does location match?                                 │
│ - Am I using authoritative sources?                    │
└─────────────────────────────────────────────────────────┘
         │
         └─→ verification (1934-1956) [SEÇÃO COMPLETA]
             - Early stop criteria
             - Stop condition
             - Detailed checklist
```

**Ação**: Manter verificação detalhada apenas em verification

---

## Matriz de Consolidação

| Seção Original | Pode Ser Consolidada Com | Redução Estimada |
|----------------|---------------------------|------------------|
| `directional_audio` | `structure` (parte 1) | ~50-80 chars |
| `style` | `structure` | ~80-120 chars |
| `low_data_fallback` | `structure` (nota final) | ~30-50 chars |
| `location_verification` | `non_negotiable_rules` | ~100-150 chars |
| `reference_links_processing` | `data_guardrails` | ~150-200 chars |
| `planning` (verificação) | `verification` | ~100-150 chars |

**Total de consolidações**: ~510-750 caracteres

---

## Priorização de Otimizações

### Prioridade ALTA (Baixo Risco, Alto Impacto)
1. ✅ Consolidar regra "never invent" (8 → 3 ocorrências)
2. ✅ Simplificar referências "DATA BLOCKS" (18 → 5-6 ocorrências)
3. ✅ Consolidar verificação de localização (4 → 1 seção)

**Redução**: ~550 caracteres | **Risco**: BAIXO

### Prioridade MÉDIA (Médio Risco, Médio Impacto)
4. ⚠️ Simplificar priorização de fontes (3 → 1 seção principal)
5. ⚠️ Consolidar regras de datas (4 → 1 seção principal)
6. ⚠️ Simplificar estrutura 4 partes (4 → 1 definição completa)

**Redução**: ~450 caracteres | **Risco**: MÉDIO

### Prioridade BAIXA (Baixo Risco, Baixo Impacto)
7. ✅ Consolidar especificidade (3 → 1 seção)
8. ✅ Consolidar verificação final (2 → 1 seção)
9. ✅ Consolidar directional_audio + style em structure

**Redução**: ~300 caracteres | **Risco**: BAIXO

---

## Estrutura Otimizada Proposta

```
<context>
  [Mantém: audience, location, sources, data blocks]
</context>

<task>
  [Mantém: generate description]
</task>

<role>
  [Mantém: licensed tourist guide]
</role>

<core_rules>
  [NOVO: Consolida non_negotiable_rules + location_verification]
  - Never invent/guess/estimate dates or facts
  - Use ONLY information from DATA BLOCKS in context
  - If fact not in DATA BLOCKS, omit entirely
  - Verify location: Name in City, State, Country
  - Only include facts explicitly stated for this location
</core_rules>

<goal>
  [Simplificado: Referencia structure]
  Deliver 4-part description following structure below
</goal>

<date_handling>
  [Mantém: Todas as regras consolidadas aqui]
  - Critical rules
  - Date calculation from "X years"
  - Conflict resolution
  - Fallback
</date_handling>

<structure>
  [EXPANDIDO: Inclui style + directional_audio + fallback]
  1. OPENING (no directional cue, POI name/action)
  2. TIMELINE (dates only if in DATA BLOCKS or calculated)
  3. DISTINCTIVE DETAIL (one curiosity, phrase only once)
  4. SENSORY/PRESENT MOMENT (present-tense image)
  
  Style: Verbs/concrete nouns, guide-like rhythm, 25s window
  Fallback: If minimal data, 2-3 factual sentences, present tense
</structure>

<source_priority>
  [NOVO: Consolida reference_links + data_guardrails]
  Hierarchy: Official website > Reference links > Government/Heritage > 
             City/Municipal > Database > Scraped content > 
             Academic > Google > OSM > Tokens
  
  Reference links: Extract all facts, calculate dates from "X years"
  Specificity: Use specific facts, avoid generic descriptions
  Verification: All facts traceable to sources
</source_priority>

<curiosity_selection>
  [Mantém: Order of preference]
</curiosity_selection>

<prohibited>
  [Mantém: Lista de proibições]
</prohibited>

<workflow>
  [NOVO: Consolida planning + verification]
  1. ANALYZE: Review DATA BLOCKS, identify dates/curiosities/sources
  2. PLAN: Create 4-part outline following structure
  3. VERIFY & EXECUTE: 
     - All dates in DATA BLOCKS or calculated?
     - Location matches?
     - All facts traceable?
     - Structure complete?
     - Word count ≤ 85?
     - No prohibited content?
     - Write description
</workflow>

<output_format>
  [Mantém: Plain text, max 85 words]
</output_format>
```

**Redução total estimada**: ~1,300 caracteres (~10.5%)
**Número de seções**: 18 → 12 (-33%)

