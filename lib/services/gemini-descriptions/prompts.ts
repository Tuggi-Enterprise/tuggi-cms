/**
 * Prompt Templates for Gemini Description Service
 * 
 * Optimized prompts following Google's official best practices:
 * - Clear structure (P.R.O.M.P.T framework)
 * - Few-shot examples
 * - Chain-of-thought reasoning
 * - Reduced redundancies
 * - All prompts in English
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
    existingDescription?: string
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
  
  // Elevation/height
  if (poiData.osm_tags?.ele) {
    context.push(`Elevation: ${poiData.osm_tags.ele} meters`)
  }
  if (poiData.osm_tags?.['height']) {
    context.push(`Height: ${poiData.osm_tags['height']} meters`)
  }
  
  // Historical dates
  if (poiData.osm_tags?.['start_date']) {
    context.push(`Foundation/Construction Year: ${poiData.osm_tags['start_date']}`)
  }
  if (poiData.osm_tags?.['historic:period']) {
    context.push(`Historical Period: ${poiData.osm_tags['historic:period']}`)
  }
  if (poiData.osm_tags?.['year']) {
    context.push(`Year: ${poiData.osm_tags['year']}`)
  }
  
  // Architectural data
  if (poiData.osm_tags?.['architect']) {
    context.push(`Architect: ${poiData.osm_tags['architect']}`)
  }
  if (poiData.osm_tags?.['architectural_style']) {
    context.push(`Architectural Style: ${poiData.osm_tags['architectural_style']}`)
  }
  
  // Category/type
  if (poiData.google_types && poiData.google_types.length > 0) {
    context.push(`Type: ${poiData.google_types.join(', ')}`)
  }
  
  // Official website
  if (poiData.website) {
    context.push(`Official Website: ${poiData.website}`)
  }
  
  // Reference links (admin curated authoritative sources)
  if (poiData.reference_links && poiData.reference_links.length > 0) {
    context.push(`\nREFERENCE LINKS (Authoritative Sources - Read and understand these):`)
    poiData.reference_links.forEach((link, index) => {
      context.push(`Reference ${index + 1}: ${link}`)
    })
    context.push(`\nNOTE: These reference links may contain relevant information about this POI.`)
    context.push(`Read and understand the content of these links - they may include dates, numbers, historical events, architectural details, or cultural significance that could enrich the description.`)
    context.push(`Use information from these links when relevant, but maintain your freedom to use your knowledge and judgment.`)
  }
  
  return context.length > 0 ? `\nAVAILABLE DATA:\n${context.join('\n')}\n` : ''
}

/**
 * Core rules (shared across all prompts to reduce redundancy)
 */
function getCoreRules(): string {
  return `CRITICAL RULES:
- **NO DIRECTIONAL CUES**: Never include location signals (e.g., "to your right", "to your left", "ahead", "look at", "see")
- **DIRECTIONAL AUDIO**: Directional audio is calculated separately by the system based on user bearing
- **START WITH POI NAME**: Begin description by naturally mentioning the POI name ({{name}})
- **USE YOUR KNOWLEDGE**: Complement provided data with your knowledge about the POI (cultural nicknames, traditions, historical facts, dates, numbers)
- **NO HALLUCINATION**: Never invent information you don't know. Use only well-established, verifiable facts from your knowledge or provided data
- **CITY ACCURACY**: Use ONLY the city provided in data ({{city}}). If no city provided, do not mention city
- **BE PRECISE**: Avoid words like "approximately", "around", "probably" - be precise or omit
- **EXCLUDE**: Full addresses, hours, prices, phones, directions, directional signals`
}

/**
 * Content priority guidelines (shared)
 */
function getContentPriority(): string {
  return `CONTENT PRIORITY (cultural and historical information are the DIFFERENTIATOR):
1. **CULTURAL INFORMATION AND POPULAR NICKNAMES** (HIGH PRIORITY):
   - Popular nicknames (e.g., "sausage city", "steel city", "sugar loaf land")
   - Colloquial or traditional designations (e.g., "coffee capital", "aviation cradle")
   - Distinctive cultural traditions (festivals, typical gastronomy, crafts, etc.)
   - Cultural characteristics that make the location unique
   - Integrate naturally into text, don't just mention

2. **HISTORICAL FACTS AND CURIOSITIES** (HIGH PRIORITY):
   - Important historical events (from data or your knowledge)
   - Associated historical personalities and what they did there
   - Verifiable historical curiosities
   - Historical and cultural context
   - Historical or cultural importance
   - Integrate into main text, don't just mention

3. **Historical dates** (when available):
   - Foundation/construction year (e.g., "founded in 1895") - from data or your knowledge
   - Relevant historical periods
   - Important event dates
   - Use only confirmed dates from provided data or your knowledge

4. **Specific numbers** (when relevant):
   - Elevation/height (e.g., "at 1,135 meters altitude")
   - Dimensions, capacity, or other relevant numbers
   - Use exact numbers from provided data or your knowledge

5. **Physical or architectural characteristics**:
   - Architectural style (when relevant)
   - Distinctive features
   - Architect or builder (when known)`
}

/**
 * Get few-shot examples for description generation
 * Based on Google's official recommendation for few-shot prompting
 * Includes examples for improving existing descriptions
 */
function getFewShotExamples(existingDescription?: string): string {
  const baseExamples = `CORRECT DESCRIPTION EXAMPLES (follow this format and style):

<example>
<poi>Museu do Telefone</poi>
<description>The Museu do Telefone preserves a fascinating piece of communication history. It was here that Dom Pedro Primeiro made the first telephone call in the state of São Paulo, a milestone that revolutionized how people connected. This place celebrates technological evolution and the importance of communication networks in our society.</description>
</example>

<example>
<poi>Pico do Jaraguá</poi>
<description>Pico do Jaraguá rises to 1,135 meters altitude, being the highest point in the city. Jaraguá State Park, created in 1946, protects this preserved Atlantic Forest area, a refuge for local fauna and flora. Walk the trails and feel the refreshing breeze while discovering the importance of this historical place.</description>
</example>

<example>
<poi>Bragança Paulista</poi>
<description>Bragança Paulista, known as the sausage city, is a municipality with rich gastronomic and cultural tradition. Founded in 1850, the city preserves its history while celebrating its famous artisanal sausage production, which became a symbol of local identity and attracts visitors seeking this regional delicacy.</description>
</example>

<example>
<poi>Igreja de São Pedro</poi>
<description>The Igreja de São Pedro, built in the 18th century, represents an important architectural landmark from the colonial period. Its baroque-style facade and preserved interior details tell the story of faith and sacred art in the region. A place that connects historical past with contemporary devotion.</description>
</example>`

  const improvementExamples = existingDescription ? `

EXAMPLES OF IMPROVING EXISTING DESCRIPTIONS (when existing description is provided):

<example>
<poi>Museu do Telefone</poi>
<existing_description>The Museu do Telefone is a museum about telephones. It has old phones and shows how phones changed over time.</existing_description>
<improved_description>The Museu do Telefone preserves a fascinating piece of communication history. It was here that Dom Pedro Primeiro made the first telephone call in the state of São Paulo, a milestone that revolutionized how people connected. This place celebrates technological evolution and the importance of communication networks in our society.</improved_description>
<analysis>Notice how the improved version adds: specific historical event (Dom Pedro Primeiro's call), location context (state of São Paulo), and broader significance (technological evolution). It does NOT repeat "old phones" or "shows how phones changed" - it adds NEW information.</analysis>
</example>

<example>
<poi>Pico do Jaraguá</poi>
<existing_description>Pico do Jaraguá is a mountain in São Paulo. It's a nice place to visit.</existing_description>
<improved_description>Pico do Jaraguá rises to 1,135 meters altitude, being the highest point in the city. Jaraguá State Park, created in 1946, protects this preserved Atlantic Forest area, a refuge for local fauna and flora. Walk the trails and feel the refreshing breeze while discovering the importance of this historical place.</improved_description>
<analysis>Notice how the improved version adds: specific elevation (1,135 meters), park creation date (1946), ecological context (Atlantic Forest, fauna/flora), and activity suggestion (walk trails). It does NOT repeat "mountain" or "nice place" - it adds NEW specific information.</analysis>
</example>

<example>
<poi>Praça da Poesia Poeta Oswaldo de Camargo</poi>
<existing_description>A Praça da Poesia Poeta Oswaldo de Camargo é um tributo à arte e à literatura em Bragança Paulista. Este espaço verde homenageia o renomado poeta Oswaldo de Camargo, conectando os visitantes à rica cultura da cidade. É um convite à leitura e ao lazer, um refúgio tranquilo para apreciar a poesia e a serenidade local.</existing_description>
<improved_description>A Praça da Poesia Poeta Oswaldo de Camargo foi inaugurada em 2015, ocupando uma área de 2.500 metros quadrados no centro de Bragança Paulista. O espaço celebra Oswaldo de Camargo, poeta afro-brasileiro nascido em 1933, reconhecido por sua obra que aborda questões raciais e identitárias na literatura brasileira. A praça abriga esculturas temáticas, bancos com trechos de poemas e um acervo literário ao ar livre, promovendo encontros culturais e saraus poéticos mensais que reúnem a comunidade local.</improved_description>
<analysis>CRITICAL: Notice how the improved version:
- Uses COMPLETELY DIFFERENT structure (starts with date/area instead of "tributo")
- Adds SPECIFIC information NOT in original: inauguration year (2015), area (2,500 m²), poet's birth year (1933), his significance (afro-brasileiro, questões raciais)
- Includes NEW details: esculturas temáticas, bancos com poemas, acervo literário, saraus mensais
- Uses DIFFERENT vocabulary: "foi inaugurada", "celebra", "reconhecido por" instead of "tributo", "homenageia", "renomado"
- Focuses on DIFFERENT aspects: physical features and activities instead of general concepts
- Does NOT repeat: "tributo", "espaço verde", "conectando", "convite à leitura", "refúgio tranquilo"</analysis>
</example>` : ''

  return baseExamples + improvementExamples + `

Note that all descriptions:
- Start with the POI name
- Include popular nicknames or cultural traditions when known (e.g., "known as the sausage city")
- Include verifiable historical facts
- Include numbers or dates when available
- Have no directional signals
- Are engaging and informative
- Maintain friendly and welcoming tone
${existingDescription ? '- When improving existing descriptions: ADD new information, DO NOT repeat what is already mentioned' : ''}`
}

/**
 * Get guidance for handling existing descriptions
 * Based on Google's best practices for iterative improvement
 * Enhanced to be more explicit about avoiding repetition
 */
function getExistingDescriptionGuidance(existingDescription: string): string {
  return `⚠️ EXISTING DESCRIPTION PROVIDED - CRITICAL MODE ⚠️

You have been provided with an EXISTING DESCRIPTION for this POI. Your task is to GENERATE A COMPLETELY NEW DESCRIPTION that:
1. **AVOIDS REPETITION**: Do NOT reuse phrases, sentences, or concepts from the existing description
2. **ADDS NEW INFORMATION**: Include information NOT present in the existing description
3. **DIFFERENT PERSPECTIVE**: Use different wording, structure, and focus
4. **SEEK UNIQUE DETAILS**: Use your knowledge to find unique facts, dates, numbers, or cultural aspects NOT mentioned

EXISTING DESCRIPTION (DO NOT REPEAT THIS):
${existingDescription}

🔴 ABSOLUTE PROHIBITIONS:
- **DO NOT** reuse the same phrases or sentences
- **DO NOT** paraphrase the existing description
- **DO NOT** keep the same structure or flow
- **DO NOT** mention the same concepts in the same way
- **DO NOT** generate a description that is essentially the same

✅ WHAT YOU MUST DO:
- **GENERATE A FRESH DESCRIPTION**: Write a completely new description from scratch
- **USE DIFFERENT WORDS**: Use different vocabulary and expressions
- **FOCUS ON NEW FACTS**: Prioritize information NOT in the existing description:
  * Specific dates (foundation, inauguration, historical events)
  * Exact numbers (dimensions, capacity, population)
  * Cultural nicknames or designations
  * Historical personalities and their specific contributions
  * Architectural details or styles
  * Cultural traditions or festivals
  * Unique characteristics or curiosities
- **DIFFERENT STRUCTURE**: Organize information differently
- **NEW PERSPECTIVE**: Approach the description from a different angle

🎯 YOUR KNOWLEDGE IS KEY:
Use your knowledge about this POI to find information that is:
- NOT mentioned in the existing description
- More specific (dates, numbers, names)
- More culturally rich (nicknames, traditions)
- More historically detailed (events, personalities)
- More contextually informative (significance, importance)

EXAMPLE OF WHAT TO AVOID:
If existing says: "homenageia o renomado poeta Oswaldo de Camargo"
DO NOT say: "homenageia o poeta Oswaldo de Camargo" or "é uma homenagem ao poeta Oswaldo de Camargo"
INSTEAD say: "celebra a obra de Oswaldo de Camargo, poeta nascido em [year] que [specific contribution]" or add: "inaugurada em [date]" or "com [specific feature]"

Generate a COMPLETELY NEW description that adds substantial new information.`
}

/**
 * Get chain-of-thought reasoning structure
 * Based on Google's recommendation for step-by-step reasoning
 * Enhanced to handle existing descriptions
 */
function getChainOfThought(existingDescription?: string): string {
  const existingDescSection = existingDescription ? `
STEP 0: ANALYZE EXISTING DESCRIPTION (if provided) - ⚠️ CRITICAL STEP
- Read the existing description carefully and identify ALL information mentioned
- **MANDATORY**: Create a mental list of what is ALREADY covered:
  * Concepts mentioned (e.g., "tributo à arte", "espaço verde", "homenageia poeta")
  * Facts mentioned (e.g., "Oswaldo de Camargo", "Bragança Paulista")
  * Themes mentioned (e.g., "literatura", "cultura", "leitura", "lazer")
- **CRITICAL**: You MUST generate a description that:
  * Uses COMPLETELY DIFFERENT wording
  * Includes information NOT in the existing description
  * Has a DIFFERENT structure and flow
  * Focuses on DIFFERENT aspects or details
- **FORBIDDEN**: Do NOT reuse phrases, sentences, or paraphrased versions
- **YOUR MISSION**: Find NEW information from your knowledge:
  * Specific dates (when was it inaugurated? when was the poet born?)
  * Exact numbers (dimensions, area, number of elements)
  * Cultural context (why is this poet important? what is his significance?)
  * Historical events (what happened here? what is the history?)
  * Architectural details (what features does it have?)
  * Cultural traditions (any festivals or events?)
- **APPROACH**: Think "What would someone who hasn't read the existing description want to know?"` : ''

  return `GENERATION PROCESS (follow these steps in order):${existingDescSection}

STEP 1: ANALYZE PROVIDED DATA AND YOUR KNOWLEDGE
- **IF REFERENCE LINKS ARE PROVIDED**: Read and understand them - they may contain relevant information about dates, numbers, architectural details, historical events, or cultural activities
- Identify popular nicknames, colloquial designations, or known cultural traditions about this location
- Identify historical facts available in provided data
- Identify numbers and dates available (elevation, foundation year, etc.)
- Identify POI characteristics (type, architectural style, etc.)
- **IMPORTANT**: Use your knowledge about the POI to complement provided data
- **IMPORTANT**: If you know popular nicknames, cultural traditions, historical facts, dates, numbers, or curiosities about this location, USE THEM
${existingDescription ? '- **IMPORTANT**: Prioritize information NOT already mentioned in the existing description' : ''}
- **COMBINE SOURCES**: Use information from reference links, your knowledge, and provided structured data - combine them intelligently
- Combine provided data with your knowledge to create a rich description
- Check if there is additional context provided

STEP 2: VERIFY ACCURACY
- Use provided data as base, but complement with your knowledge when relevant
- Use well-established and verifiable historical facts (from your knowledge or data)
- If no historical data available, use your knowledge about the location if available
- Be precise: use concrete information when you know it, be generic when you don't
- DO NOT use words like "approximately", "around", "probably" - be precise or omit

STEP 3: STRUCTURE THE DESCRIPTION
- Start with POI name naturally (e.g., "The Museu do Telefone...")
- Integrate popular nicknames or cultural traditions naturally when known (e.g., "known as the sausage city")
${existingDescription ? `- **CRITICAL**: Use COMPLETELY DIFFERENT structure than the existing description
- **CRITICAL**: Start with a DIFFERENT aspect (if existing starts with "tributo", start with date, location, or specific feature)
- **CRITICAL**: Use DIFFERENT connecting words and phrases
- Integrate NEW information that is NOT in the existing description
- Focus on specific details: dates, numbers, names, events NOT mentioned before` : '- Integrate historical facts naturally into text'}
- Include numbers/dates when available (e.g., "1,135 meters", "founded in 1946")
- Maintain friendly and engaging tone
- Prioritize cultural and historical information as differentiator

STEP 4: GENERATE FINAL TEXT
- Maximum specified words
- Short sentences for audio narration
- No directional signals (to your right, etc.)
- Pure text only, no metadata or comments
- Verify it starts with POI name
${existingDescription ? '- Verify you are NOT repeating information from the existing description' : ''}`
}

/**
 * Information sources guidance (consolidated)
 * Enhanced to acknowledge reference links without restricting AI freedom
 */
function getInformationSources(hasReferenceLinks: boolean = false): string {
  const referenceLinksSection = hasReferenceLinks ? `
- **REFERENCE LINKS**: If reference links are provided, they contain authoritative, admin-curated information
- **READ AND UNDERSTAND**: Read and understand the content of reference links - they may contain relevant facts such as:
  * Foundation/inauguration dates
  * Architectural details or characteristics
  * Historical events or significance
  * Cultural activities or traditions
  * Specific numbers, dimensions, or capacity
  * Community involvement or social impact
- **USE WHEN RELEVANT**: Use information from reference links when it adds value to the description, but maintain your freedom to use your knowledge and judgment` : ''

  return `INFORMATION SOURCES:
- Provided data below is the BASE, but you must COMPLEMENT with your knowledge about the POI${referenceLinksSection}
- If you know historical facts, dates, numbers, curiosities, or events about this location, USE THEM in the description
- Combine provided data with your knowledge to create a rich and informative description
- Do not rely solely on provided data - use your intelligence to enrich the description`
}

/**
 * Touristic Style Prompt
 * Friendly, engaging, suitable for audio guides
 * Optimized following Google's best practices
 */
export function getTouristicPrompt(
  poiData: POIData,
  options: {
    maxWords: number
    audioDuration: string
    language: string
    additionalContext?: string
    existingDescription?: string
  }
): string {
  const vars = buildPromptVariables(poiData, options)
  const dataContext = buildDataContext(poiData)
  const hasExisting = !!options.existingDescription
  const hasReferenceLinks = !!(poiData.reference_links && poiData.reference_links.length > 0)
  
  const template = `PERSONA:
You are a tour guide specialized in Brazilian history and culture.

TASK:
${hasExisting 
  ? `⚠️ GENERATE A COMPLETELY NEW DESCRIPTION in Brazilian Portuguese for {{audioDuration}} audio (maximum {{maxWords}} words).
  
CRITICAL: The existing description below is provided ONLY as reference. You MUST generate a DIFFERENT description with:
- DIFFERENT wording and structure
- NEW information not in the existing description
- DIFFERENT focus and perspective
- Specific details: dates, numbers, names, events NOT mentioned before

DO NOT paraphrase, reuse, or repeat the existing description.`
  : `Create an engaging description in Brazilian Portuguese for {{audioDuration}} audio (maximum {{maxWords}} words).`
}
The description will be played AFTER a directional audio calculated by the system based on user bearing.

${hasExisting ? getExistingDescriptionGuidance(options.existingDescription!) : ''}

${getInformationSources(hasReferenceLinks)}

${getChainOfThought(options.existingDescription)}

${getFewShotExamples(options.existingDescription)}

${getCoreRules()}

${getContentPriority()}

${dataContext}${vars.context ? `\nADDITIONAL CONTEXT:\n${vars.context}\n` : ''}

Reference Date: {{currentDate}} (year {{currentYear}})

Generate ONLY the description text following the examples above, without comments or metadata.`

  return replacePlaceholders(template, vars)
}

/**
 * Historical Style Prompt
 * Focus on historical facts and significance
 */
export function getHistoricalPrompt(
  poiData: POIData,
  options: {
    maxWords: number
    audioDuration: string
    language: string
    additionalContext?: string
    existingDescription?: string
  }
): string {
  const vars = buildPromptVariables(poiData, options)
  const dataContext = buildDataContext(poiData)
  const hasExisting = !!options.existingDescription
  const hasReferenceLinks = !!(poiData.reference_links && poiData.reference_links.length > 0)
  
  const template = `PERSONA:
You are a historian specialized in Brazilian history.

TASK:
${hasExisting 
  ? `IMPROVE and ENRICH an existing historical description in Brazilian Portuguese for {{audioDuration}} audio (maximum {{maxWords}} words).`
  : `Create a historical description in Brazilian Portuguese for {{audioDuration}} audio (maximum {{maxWords}} words).`
}
The description will be played AFTER a directional audio calculated by the system.

${hasExisting ? getExistingDescriptionGuidance(options.existingDescription!) : ''}

${getInformationSources(hasReferenceLinks)}

${getChainOfThought(options.existingDescription)}

${getFewShotExamples(options.existingDescription)}

${getCoreRules()}

CONTENT PRIORITY (whenever available):
1. **Historical dates** (HIGH PRIORITY):
   - Foundation/construction year (e.g., "founded in 1895") - from data or your knowledge
   - Historical periods (e.g., "18th century", "1920s")
   - Important event dates
   - Use dates from provided data or your knowledge (only well-established dates)

2. **Numbers and dimensions** (when relevant):
   - Height, elevation, dimensions - from data or your knowledge
   - Capacity, historical population
   - Other numbers that provide historical context
   - Use numbers from provided data or your knowledge (only well-established numbers)

3. **Verifiable historical facts**:
   - Important historical events (from data or your knowledge)
   - Associated historical personalities (from data or your knowledge)
   - Historical and political context
   - Historical and cultural importance
   - Changes over time

4. **Historical architectural characteristics**:
   - Architectural style and period
   - Historical architect or builder
   - Distinctive features of the era

${dataContext}${vars.context ? `\nADDITIONAL CONTEXT:\n${vars.context}\n` : ''}

Reference Date: {{currentDate}} (year {{currentYear}})

Generate ONLY the description text following the examples above, without comments or metadata.`

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
    existingDescription?: string
  }
): string {
  const vars = buildPromptVariables(poiData, options)
  const hasExisting = !!options.existingDescription
  const hasReferenceLinks = !!(poiData.reference_links && poiData.reference_links.length > 0)
  
  const template = `PERSONA:
You are a specialist in Brazilian cultural heritage.

TASK:
${hasExisting 
  ? `IMPROVE and ENRICH an existing cultural description in Brazilian Portuguese for {{audioDuration}} audio (maximum {{maxWords}} words).`
  : `Create a description about cultural significance in Brazilian Portuguese for {{audioDuration}} audio (maximum {{maxWords}} words).`
}
The description will be played AFTER a directional audio calculated by the system.

${hasExisting ? getExistingDescriptionGuidance(options.existingDescription!) : ''}

${getInformationSources(hasReferenceLinks)}

${getChainOfThought(options.existingDescription)}

${getFewShotExamples(options.existingDescription)}

${getCoreRules()}

FOCUS:
- Cultural and heritage significance (from data or your knowledge)
- Architectural, artistic, or traditional characteristics (when known and verifiable - from data or your knowledge)
- Why the location is culturally important
- Respectful and informative language

${vars.context ? `ADDITIONAL CONTEXT:\n${vars.context}\n` : ''}

Reference Date: {{currentDate}} (year {{currentYear}})

Generate ONLY the description text following the examples above, without comments or metadata.`

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
    existingDescription?: string
  }
): string {
  const vars = buildPromptVariables(poiData, options)
  const hasExisting = !!options.existingDescription
  const hasReferenceLinks = !!(poiData.reference_links && poiData.reference_links.length > 0)
  
  const template = `PERSONA:
You are a specialized informative guide.

TASK:
${hasExisting 
  ? `IMPROVE and ENRICH an existing simple description in Brazilian Portuguese for {{audioDuration}} audio (maximum {{maxWords}} words).`
  : `Create a simple and objective description in Brazilian Portuguese for {{audioDuration}} audio (maximum {{maxWords}} words).`
}
The description will be played AFTER a directional audio calculated by the system.

${hasExisting ? getExistingDescriptionGuidance(options.existingDescription!) : ''}

${getInformationSources(hasReferenceLinks)}

${getChainOfThought(options.existingDescription)}

${getFewShotExamples(options.existingDescription)}

${getCoreRules()}

- Be direct and informative
- Use clear and natural language

${vars.context ? `CONTEXT:\n${vars.context}\n` : ''}

Generate ONLY the description text following the examples above.`

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
    existingDescription?: string
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
 * Enhanced following Google's best practices
 */
export function getSystemInstruction(
  audioDuration: string = '30s',
  maxWords: number = 120
): string {
  return `PERSONA:
You are an expert in creating touristic descriptions for audio guides.

OBJECTIVE:
Create descriptions in Brazilian Portuguese that are:
- Informative and engaging
- Appropriate for audio narration
- Duration of ${audioDuration} (maximum ${maxWords} words)
- Focused on verifiable facts

AUDIO STRUCTURE:
- Directional audio ("To your right", etc.) will be played BEFORE this description
- This description will be played AFTER the directional audio
- Directional audio is calculated separately by the system based on user bearing

CONTENT PRIORITIES:
1. **Include specific numbers** when available:
   - Height, elevation, dimensions (e.g., "1,135 meters altitude")
   - Capacity, population, or other relevant numbers
   - Use exact numbers, not approximations

2. **Include historical dates** when available:
   - Foundation/construction year (e.g., "founded in 1895")
   - Historical periods (e.g., "18th century")
   - Important event dates
   - Use exact dates, avoid "approximately" or "around"

3. **Include verifiable historical facts**:
   - Important historical events
   - Associated historical personalities
   - Historical and cultural context
   - Historical or cultural importance

CRITICAL RULES:
- **GENERIC**: Works for any type of POI (museums, churches, monuments, parks, etc.), known or unknown
- **NO HALLUCINATION**: NEVER invent information, numbers, dates, historical facts, or location characteristics
- **CITY ACCURACY**: Use ONLY the city provided in data. If no city provided, do not mention city
- **CRITICAL**: Do NOT include directional signals (e.g., "to your right", "to your left", "ahead", "look at", "see")
- **MANDATORY**: Description must start by naturally mentioning the POI name (e.g., "The Museu do Telefone...", "Pico do Jaraguá...", "The Igreja de São Pedro...")
- NEVER include full addresses, hours, prices, or phones
- Use only known and verifiable historical or cultural facts
- Keep sentences short and natural for narration
- Use friendly and welcoming tone
- Be precise: prefer omitting information to inventing or approximating
- Focus on what makes the location special or interesting`
}
