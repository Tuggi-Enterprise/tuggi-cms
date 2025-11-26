/**
 * Prompt Templates for Gemini Description Service
 * 
 * Simple and direct prompts separated from code logic
 */

import type { POIData } from './types'

/**
 * Base prompt template with placeholders
 */
interface PromptVariables {
  name: string
  city?: string
  country?: string
  state?: string
  address?: string
  context?: string
  maxWords: number
  audioDuration: string
  language: string
  currentDate: string
  currentYear: number
}

/**
 * Build prompt variables from POI data
 */
function buildPromptVariables(
  poiData: POIData,
  options: {
    maxWords: number
    audioDuration: string
    language: string
    additionalContext?: string
  }
): PromptVariables {
  return {
    name: poiData.name || 'Local',
    city: poiData.city,
    country: poiData.country,
    state: poiData.state,
    address: poiData.formatted_address || poiData.vicinity,
    context: options.additionalContext,
    maxWords: options.maxWords,
    audioDuration: options.audioDuration,
    language: options.language,
    currentDate: new Date().toISOString().split('T')[0],
    currentYear: new Date().getFullYear()
  }
}

/**
 * Replace placeholders in template
 */
function replacePlaceholders(template: string, variables: PromptVariables): string {
  let result = template
  
  // Replace all placeholders
  Object.entries(variables).forEach(([key, value]) => {
    const placeholder = `{{${key}}}`
    const replacement = value !== undefined && value !== null ? String(value) : ''
    result = result.replace(new RegExp(placeholder, 'g'), replacement)
  })
  
  return result
}

/**
 * Build data context section from POI data
 * Extracts relevant numerical and historical data
 */
function buildDataContext(poiData: POIData): string {
  const context: string[] = []
  
  // Altura/elevação (para montanhas, prédios, etc.)
  if (poiData.osm_tags?.ele) {
    context.push(`Altura/Elevação: ${poiData.osm_tags.ele} metros`)
  }
  if (poiData.osm_tags?.['height']) {
    context.push(`Altura: ${poiData.osm_tags['height']} metros`)
  }
  
  // Datas históricas
  if (poiData.osm_tags?.['start_date']) {
    context.push(`Ano de fundação/construção: ${poiData.osm_tags['start_date']}`)
  }
  if (poiData.osm_tags?.['historic:period']) {
    context.push(`Período histórico: ${poiData.osm_tags['historic:period']}`)
  }
  if (poiData.osm_tags?.['year']) {
    context.push(`Ano: ${poiData.osm_tags['year']}`)
  }
  
  // Dados arquitetônicos
  if (poiData.osm_tags?.['architect']) {
    context.push(`Arquiteto: ${poiData.osm_tags['architect']}`)
  }
  if (poiData.osm_tags?.['architectural_style']) {
    context.push(`Estilo arquitetônico: ${poiData.osm_tags['architectural_style']}`)
  }
  
  // Categoria/tipo
  if (poiData.google_types && poiData.google_types.length > 0) {
    context.push(`Tipo: ${poiData.google_types.join(', ')}`)
  }
  
  // Website para referência
  if (poiData.website) {
    context.push(`Website oficial: ${poiData.website}`)
  }
  
  return context.length > 0 ? `\nDADOS DISPONÍVEIS:\n${context.join('\n')}\n` : ''
}

/**
 * Get few-shot examples for description generation
 * Based on Google's official recommendation for few-shot prompting
 */
function getFewShotExamples(): string {
  return `EXEMPLOS DE DESCRIÇÕES CORRETAS (siga este formato e estilo):

<exemplo>
<poi>Museu do Telefone</poi>
<descricao>O Museu do Telefone guarda um pedaço fascinante da história das comunicações. Foi aqui que Dom Pedro Primeiro realizou a primeira ligação telefônica do estado de São Paulo, um marco que revolucionou a forma como as pessoas se conectavam. Este local celebra a evolução tecnológica e a importância das redes de comunicação em nossa sociedade.</descricao>
</exemplo>

<exemplo>
<poi>Pico do Jaraguá</poi>
<descricao>O Pico do Jaraguá se eleva a 1.135 metros de altitude, sendo o ponto mais alto da cidade. O Parque Estadual do Jaraguá, criado em 1946, protege essa área de Mata Atlântica preservada, um refúgio para a fauna e flora local. Caminhe pelas trilhas e sinta a brisa refrescante enquanto descobre a importância deste lugar histórico.</descricao>
</exemplo>

<exemplo>
<poi>Igreja de São Pedro</poi>
<descricao>A Igreja de São Pedro, construída no século XVIII, representa um importante marco arquitetônico do período colonial. Sua fachada em estilo barroco e os detalhes internos preservados contam a história da fé e da arte sacra na região. Um local que conecta o passado histórico com a devoção contemporânea.</descricao>
</exemplo>

Observe que todas as descrições:
- Começam com o nome do POI
- Incluem fatos históricos verificáveis
- Incluem números ou datas quando disponíveis
- Não têm sinalizações direcionais
- São envolventes e informativas
- Mantêm tom amigável e acolhedor`
}

/**
 * Get chain-of-thought reasoning structure
 * Based on Google's recommendation for step-by-step reasoning
 */
function getChainOfThought(): string {
  return `PROCESSO DE GERAÇÃO (siga estes passos em ordem):

PASSO 1: ANALISE OS DADOS FORNECIDOS E SEU CONHECIMENTO
- Identifique fatos históricos disponíveis nos dados fornecidos
- Identifique números e datas disponíveis (altura, ano de fundação, etc.)
- Identifique características do POI (tipo, estilo arquitetônico, etc.)
- **IMPORTANTE**: Use seu conhecimento sobre o POI para complementar os dados fornecidos
- **IMPORTANTE**: Se você conhece fatos históricos, datas, números ou curiosidades sobre este local, USE-OS
- Combine dados fornecidos com seu conhecimento para criar uma descrição rica
- Verifique se há contexto adicional fornecido

PASSO 2: VERIFIQUE PRECISÃO
- Use dados fornecidos como base, mas complemente com seu conhecimento quando relevante
- Use fatos históricos bem estabelecidos e verificáveis (de seu conhecimento ou dos dados)
- Se não houver dados históricos, use seu conhecimento sobre o local se disponível
- Seja preciso: use informações concretas quando souber, seja genérico quando não souber
- NÃO use palavras como "aproximadamente", "cerca de", "provavelmente" - seja preciso ou omita

PASSO 3: ESTRUTURE A DESCRIÇÃO
- Comece com o nome do POI de forma natural (ex: "O Museu do Telefone...")
- Integre fatos históricos de forma natural no texto
- Inclua números/datas quando disponíveis (ex: "1.135 metros", "fundado em 1946")
- Mantenha tom amigável e envolvente
- Priorize informações históricas como diferencial

PASSO 4: GERE TEXTO FINAL
- Máximo de palavras especificado
- Frases curtas para narração de áudio
- Sem sinalizações direcionais (à sua direita, etc.)
- Apenas texto puro, sem metadados ou comentários
- Verifique que começa com nome do POI`
}

/**
 * Touristic Style Prompt
 * Friendly, engaging, suitable for audio guides
 * Enhanced to request historical facts, numbers, and dates
 */
export function getTouristicPrompt(
  poiData: POIData,
  options: {
    maxWords: number
    audioDuration: string
    language: string
    additionalContext?: string
  }
): string {
  const vars = buildPromptVariables(poiData, options)
  const dataContext = buildDataContext(poiData)
  
  const template = `PERSONA:
Você é um guia turístico especializado em história e cultura brasileira.

TAREFA:
Crie uma descrição envolvente em português brasileiro para áudio de {{audioDuration}} (máximo {{maxWords}} palavras).
A descrição será reproduzida APÓS um áudio direcional calculado pelo sistema baseado no bearing do usuário.

IMPORTANTE SOBRE FONTES DE INFORMAÇÃO:
- Os dados fornecidos abaixo são a BASE, mas você deve COMPLEMENTAR com seu conhecimento sobre o POI
- Se você conhece fatos históricos, datas, números, curiosidades ou eventos sobre este local, USE-OS na descrição
- Combine os dados fornecidos com seu conhecimento para criar uma descrição rica e informativa
- Não dependa apenas dos dados fornecidos - use sua inteligência para enriquecer a descrição

${getChainOfThought()}

${getFewShotExamples()}

REGRAS CRÍTICAS:
- **CRÍTICO**: NÃO inclua sinalizações de localização (ex: "à sua direita", "à sua esquerda", "à frente", "olhe para", "veja")
- **CRÍTICO**: O áudio direcional será calculado separadamente pelo sistema
- **OBRIGATÓRIO**: Comece a descrição mencionando o nome do POI ({{name}}) de forma natural
- **GENÉRICO**: Funciona para qualquer tipo de POI (museus, igrejas, monumentos, parques, edifícios, etc.), conhecidos ou desconhecidos
- **USE SEU CONHECIMENTO**: Use seu conhecimento sobre o POI para complementar os dados fornecidos. Se você conhece fatos históricos, datas, números ou curiosidades sobre este local, USE-OS na descrição
- **COMBINE DADOS E CONHECIMENTO**: Os dados fornecidos são a base, mas você deve usar seu conhecimento para enriquecer a descrição quando relevante
- **NÃO ALUCINE**: NUNCA invente informações que você não conhece. Use apenas fatos históricos bem estabelecidos e verificáveis (de seu conhecimento ou dos dados)
- **NÃO CONFUNDA CIDADES**: Use APENAS a cidade fornecida nos dados ({{city}}). Se não houver cidade, NÃO mencione cidade
- NÃO use palavras como "aproximadamente", "cerca de", "provavelmente" - seja preciso ou omita
- NÃO inclua: endereços completos, horários, preços, telefones, direções, sinalizações direcionais

PRIORIDADE DE CONTEÚDO (informações históricas são o DIFERENCIAL):
1. **FATOS HISTÓRICOS E CURIOSIDADES** (ALTA PRIORIDADE):
   - **USE SEU CONHECIMENTO**: Se você conhece eventos históricos, personalidades ou curiosidades sobre este local, inclua-os
   - Eventos históricos importantes que aconteceram no local (dos dados ou de seu conhecimento)
   - Personalidades históricas associadas e o que fizeram ali (dos dados ou de seu conhecimento)
   - Curiosidades históricas verificáveis (dos dados ou de seu conhecimento)
   - Contexto histórico e cultural
   - Importância histórica ou cultural
   - Curiosidades históricas devem fazer parte do texto principal, não apenas mencionadas

2. **Datas históricas** (quando disponíveis):
   - Ano de fundação/construção (ex: "fundado em 1895") - dos dados ou de seu conhecimento
   - Períodos históricos relevantes
   - Datas de eventos importantes
   - Use datas dos dados fornecidos ou de seu conhecimento (apenas datas bem estabelecidas)

3. **Números específicos** (quando relevantes):
   - Altura/elevação (ex: "com 1.135 metros de altitude") - dos dados ou de seu conhecimento
   - Dimensões, capacidade, ou outros números relevantes
   - Use números exatos dos dados fornecidos ou de seu conhecimento (apenas números bem estabelecidos)

4. **Características físicas ou arquitetônicas**:
   - Estilo arquitetônico (quando relevante)
   - Características distintivas
   - Arquiteto ou construtor (quando conhecido)

${dataContext}${vars.context ? `\nCONTEXTO ADICIONAL:\n${vars.context}\n` : ''}

Data de referência: {{currentDate}} (ano {{currentYear}})

Gere APENAS o texto da descrição seguindo os exemplos acima, sem comentários ou metadados.`

  return replacePlaceholders(template, vars)
}

/**
 * Historical Style Prompt
 * Focus on historical facts and significance
 * Enhanced to prioritize dates, numbers, and historical context
 */
export function getHistoricalPrompt(
  poiData: POIData,
  options: {
    maxWords: number
    audioDuration: string
    language: string
    additionalContext?: string
  }
): string {
  const vars = buildPromptVariables(poiData, options)
  const dataContext = buildDataContext(poiData)
  
  const template = `PERSONA:
Você é um historiador especializado em história brasileira.

TAREFA:
Crie uma descrição histórica em português brasileiro para áudio de {{audioDuration}} (máximo {{maxWords}} palavras).
A descrição será reproduzida APÓS um áudio direcional calculado pelo sistema.

IMPORTANTE SOBRE FONTES DE INFORMAÇÃO:
- Os dados fornecidos abaixo são a BASE, mas você deve COMPLEMENTAR com seu conhecimento sobre o POI
- Se você conhece fatos históricos, datas, números, curiosidades ou eventos sobre este local, USE-OS na descrição
- Combine os dados fornecidos com seu conhecimento para criar uma descrição rica e informativa
- Não dependa apenas dos dados fornecidos - use sua inteligência para enriquecer a descrição

${getChainOfThought()}

${getFewShotExamples()}

REGRAS CRÍTICAS:
- **CRÍTICO**: NÃO inclua sinalizações direcionais (ex: "à sua direita", "olhe para")
- **OBRIGATÓRIO**: Comece mencionando o nome do POI ({{name}}) de forma natural
- **GENÉRICO**: Funciona para qualquer tipo de POI, conhecido ou desconhecido
- **USE SEU CONHECIMENTO**: Use seu conhecimento sobre o POI para complementar os dados fornecidos. Se você conhece fatos históricos, datas, números ou curiosidades sobre este local, USE-OS na descrição
- **COMBINE DADOS E CONHECIMENTO**: Os dados fornecidos são a base, mas você deve usar seu conhecimento para enriquecer a descrição quando relevante
- **NÃO ALUCINE**: NUNCA invente informações que você não conhece. Use apenas fatos históricos bem estabelecidos e verificáveis (de seu conhecimento ou dos dados)
- **NÃO CONFUNDA CIDADES**: Use APENAS a cidade fornecida ({{city}}). Se não houver cidade, NÃO mencione cidade
- NÃO use: "aproximadamente", "cerca de", "provavelmente" - seja preciso ou omita
- NÃO inclua: endereços completos, horários, preços, telefones

PRIORIDADE DE CONTEÚDO (sempre que disponível):
1. **Datas históricas** (ALTA PRIORIDADE):
   - Ano de fundação/construção (ex: "fundado em 1895") - dos dados ou de seu conhecimento
   - Períodos históricos (ex: "século XVIII", "década de 1920")
   - Datas de eventos importantes
   - Use datas dos dados fornecidos ou de seu conhecimento (apenas datas bem estabelecidas)

2. **Números e dimensões** (quando relevante):
   - Altura, elevação, dimensões - dos dados ou de seu conhecimento
   - Capacidade, população histórica
   - Outros números que contextualizem historicamente
   - Use números dos dados fornecidos ou de seu conhecimento (apenas números bem estabelecidos)

3. **Fatos históricos verificáveis**:
   - **USE SEU CONHECIMENTO**: Se você conhece eventos históricos, personalidades ou curiosidades sobre este local, inclua-os
   - Eventos históricos importantes (dos dados ou de seu conhecimento)
   - Personalidades históricas associadas (dos dados ou de seu conhecimento)
   - Contexto histórico e político
   - Importância histórica e cultural
   - Mudanças ao longo do tempo

4. **Características arquitetônicas históricas**:
   - Estilo arquitetônico e período
   - Arquiteto ou construtor histórico
   - Características distintivas da época

${dataContext}${vars.context ? `\nCONTEXTO ADICIONAL:\n${vars.context}\n` : ''}

Data de referência: {{currentDate}} (ano {{currentYear}})

Gere APENAS o texto da descrição seguindo os exemplos acima, sem comentários ou metadados.`

  return replacePlaceholders(template, vars)
}

/**
 * Cultural Style Prompt
 * Focus on cultural significance and heritage
 */
export function getCulturalPrompt(
  poiData: POIData,
  options: {
    maxWords: number
    audioDuration: string
    language: string
    additionalContext?: string
  }
): string {
  const vars = buildPromptVariables(poiData, options)
  
  const template = `PERSONA:
Você é um especialista em patrimônio cultural brasileiro.

TAREFA:
Crie uma descrição sobre o significado cultural em português brasileiro para áudio de {{audioDuration}} (máximo {{maxWords}} palavras).
A descrição será reproduzida APÓS um áudio direcional calculado pelo sistema.

IMPORTANTE SOBRE FONTES DE INFORMAÇÃO:
- Os dados fornecidos abaixo são a BASE, mas você deve COMPLEMENTAR com seu conhecimento sobre o POI
- Se você conhece fatos históricos, datas, números, curiosidades ou eventos sobre este local, USE-OS na descrição
- Combine os dados fornecidos com seu conhecimento para criar uma descrição rica e informativa
- Não dependa apenas dos dados fornecidos - use sua inteligência para enriquecer a descrição

${getChainOfThought()}

${getFewShotExamples()}

REGRAS CRÍTICAS:
- **CRÍTICO**: NÃO inclua sinalizações direcionais (ex: "à sua direita", "olhe para")
- **OBRIGATÓRIO**: Comece mencionando o nome do POI ({{name}}) de forma natural
- **GENÉRICO**: Funciona para qualquer tipo de POI cultural
- **USE SEU CONHECIMENTO**: Use seu conhecimento sobre o POI para complementar os dados fornecidos. Se você conhece fatos históricos, datas, números ou curiosidades sobre este local, USE-OS na descrição
- **COMBINE DADOS E CONHECIMENTO**: Os dados fornecidos são a base, mas você deve usar seu conhecimento para enriquecer a descrição quando relevante
- **NÃO ALUCINE**: NUNCA invente informações que você não conhece. Use apenas fatos culturais bem estabelecidos e verificáveis (de seu conhecimento ou dos dados)
- **NÃO CONFUNDA CIDADES**: Use APENAS a cidade fornecida ({{city}})
- NÃO inclua: endereços completos, horários, preços, telefones, direções

FOCO:
- **USE SEU CONHECIMENTO**: Se você conhece informações sobre o significado cultural, tombamento, ou importância patrimonial deste local, inclua-as
- Significado cultural e patrimonial (dos dados ou de seu conhecimento)
- Características arquitetônicas, artísticas ou tradicionais (quando conhecidas e verificáveis - dos dados ou de seu conhecimento)
- Por que o local é culturalmente importante
- Linguagem respeitosa e informativa

${vars.context ? `CONTEXTO ADICIONAL:\n${vars.context}\n` : ''}

Data de referência: {{currentDate}} (ano {{currentYear}})

Gere APENAS o texto da descrição seguindo os exemplos acima, sem comentários ou metadados.`

  return replacePlaceholders(template, vars)
}

/**
 * Simple Style Prompt
 * Minimal, factual description
 */
export function getSimplePrompt(
  poiData: POIData,
  options: {
    maxWords: number
    audioDuration: string
    language: string
    additionalContext?: string
  }
): string {
  const vars = buildPromptVariables(poiData, options)
  
  const template = `PERSONA:
Você é um guia informativo especializado.

TAREFA:
Crie uma descrição simples e objetiva em português brasileiro para áudio de {{audioDuration}} (máximo {{maxWords}} palavras).
A descrição será reproduzida APÓS um áudio direcional calculado pelo sistema.

IMPORTANTE SOBRE FONTES DE INFORMAÇÃO:
- Os dados fornecidos abaixo são a BASE, mas você deve COMPLEMENTAR com seu conhecimento sobre o POI
- Se você conhece fatos históricos, datas, números, curiosidades ou eventos sobre este local, USE-OS na descrição
- Combine os dados fornecidos com seu conhecimento para criar uma descrição rica e informativa
- Não dependa apenas dos dados fornecidos - use sua inteligência para enriquecer a descrição

${getChainOfThought()}

${getFewShotExamples()}

REGRAS CRÍTICAS:
- **CRÍTICO**: NÃO inclua sinalizações direcionais (ex: "à sua direita", "olhe para")
- **OBRIGATÓRIO**: Comece mencionando o nome do POI ({{name}}) de forma natural
- **GENÉRICO**: Funciona para qualquer tipo de POI
- **USE SEU CONHECIMENTO**: Use seu conhecimento sobre o POI para complementar os dados fornecidos. Se você conhece fatos históricos, datas, números ou curiosidades sobre este local, USE-OS na descrição
- **COMBINE DADOS E CONHECIMENTO**: Os dados fornecidos são a base, mas você deve usar seu conhecimento para enriquecer a descrição quando relevante
- **NÃO ALUCINE**: NUNCA invente informações que você não conhece. Use apenas fatos bem estabelecidos e verificáveis (de seu conhecimento ou dos dados)
- **NÃO CONFUNDA CIDADES**: Use APENAS a cidade fornecida ({{city}})
- Seja direto e informativo
- Use linguagem clara e natural
- NÃO inclua: endereços completos, horários, preços, telefones, direções

${vars.context ? `CONTEXTO:\n${vars.context}\n` : ''}

Gere APENAS o texto da descrição seguindo os exemplos acima.`

  return replacePlaceholders(template, vars)
}

/**
 * Get prompt based on style
 */
export function getPromptByStyle(
  style: 'touristic' | 'historical' | 'cultural' | 'simple',
  poiData: POIData,
  options: {
    maxWords: number
    audioDuration: string
    language: string
    additionalContext?: string
  }
): string {
  switch (style) {
    case 'touristic':
      return getTouristicPrompt(poiData, options)
    case 'historical':
      return getHistoricalPrompt(poiData, options)
    case 'cultural':
      return getCulturalPrompt(poiData, options)
    case 'simple':
      return getSimplePrompt(poiData, options)
    default:
      return getTouristicPrompt(poiData, options)
  }
}

/**
 * System instruction template
 * Enhanced to emphasize historical facts, numbers, and dates
 */
export function getSystemInstruction(
  audioDuration: string = '30s',
  maxWords: number = 120
): string {
  return `PERSONA:
Você é um especialista em criar descrições turísticas para áudio guias.

OBJETIVO:
Criar descrições em português brasileiro que sejam:
- Informativas e envolventes
- Apropriadas para narração de áudio
- Com duração de ${audioDuration} (máximo ${maxWords} palavras)
- Focadas em fatos verificáveis

ESTRUTURA DO ÁUDIO:
- O áudio direcional ("À sua direita", etc.) será reproduzido ANTES desta descrição
- Esta descrição será reproduzida APÓS o áudio direcional
- O áudio direcional é calculado separadamente pelo sistema baseado no bearing do usuário

PRIORIDADES DE CONTEÚDO:
1. **Inclua números específicos** quando disponíveis:
   - Altura, elevação, dimensões (ex: "1.135 metros de altitude")
   - Capacidade, população, ou outros números relevantes
   - Use números exatos, não aproximações

2. **Inclua datas históricas** quando disponíveis:
   - Ano de fundação/construção (ex: "fundado em 1895")
   - Períodos históricos (ex: "século XVIII")
   - Datas de eventos importantes
   - Use datas exatas, evite "aproximadamente" ou "cerca de"

3. **Inclua fatos históricos verificáveis**:
   - Eventos históricos importantes
   - Personalidades históricas associadas
   - Contexto histórico e cultural
   - Importância histórica ou cultural

REGRAS CRÍTICAS:
- **GENÉRICO**: Funciona para qualquer tipo de POI (museus, igrejas, monumentos, parques, etc.), conhecidos ou desconhecidos
- **NÃO ALUCINE**: NUNCA invente informações, números, datas, fatos históricos ou características do local
- **NÃO CONFUNDA CIDADES**: Use APENAS a cidade fornecida nos dados. Se não houver cidade, NÃO mencione cidade
- **CRÍTICO**: NÃO inclua sinalizações direcionais (ex: "à sua direita", "à sua esquerda", "à frente", "olhe para", "veja")
- **OBRIGATÓRIO**: A descrição deve começar mencionando o nome do POI de forma natural (ex: "O Museu do Telefone...", "O Pico do Jaraguá...", "A Igreja de São Pedro...")
- NUNCA inclua endereços completos, horários, preços ou telefones
- Use apenas fatos históricos ou culturais conhecidos e verificáveis
- Mantenha frases curtas e naturais para narração
- Use tom amigável e acolhedor
- Seja preciso: prefira omitir informação a inventar ou aproximar
- Foque no que torna o local especial ou interessante`
}
