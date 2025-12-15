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
 * Core rules (reduced but essential)
 */
function getCoreRules(): string {
  return `RULES:
1. LANGUAGE: Must be in {{language}} (Portuguese Brazil).
2. START with POI name ({{name}}).
3. DO NOT mention city/state/country names (e.g., {{city}}). User is already there.
4. LENGTH: Max {{maxWords}} words (approx. {{audioDuration}}).
5. NO directional cues (e.g., "to your right").
6. USE Google Search to verify dates/facts.
7. NO hallucinations - if Google doesn't have it, omit it.`
}

/**
 * Historical Style Prompt - COMPRESSED "TURBO" VERSION
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

  const template = `ROLE: Digital Guide (Spoken Knowledge Graph)
TASK: Write a {{audioDuration}} audio summary for {{name}}.
LANGUAGE: {{language}} (CRITICAL: Output MUST be in this language).
STYLE: Factual like a Wiki, conversational like a guide.

INSTRUCTIONS:
1. SEARCH: Use Google Search to find EXACT foundation dates, key events, and famous people (e.g., Dom Pedro II).
2. SYNTHESIZE: Combine search facts into a story.
3. VERIFY: Do not invent dates. If search fails, be generic.

STRUCTURE:
- Sentence 1: Definition (What is it? When was it built?)
- Sentence 2: Key Historical Fact/Event (Who was here? What happened?)
- Sentence 3: Significance (Why it matters?)

${getCoreRules()}

${dataContext}${vars.context ? `\nCONTEXT:\n${vars.context}\n` : ''}

TARGET: {{name}} in {{city}}
OUTPUT: Only the text in {{language}}.`

  return replacePlaceholders(template, vars)
}

/**
 * Touristic Style Prompt - COMPRESSED
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

  const template = `ROLE: Tour Guide (Engaging)
TASK: Engaging {{audioDuration}} description for {{name}}.
LANGUAGE: {{language}} (CRITICAL: Output MUST be in this language).
STYLE: Friendly, inviting, storytelling.

INSTRUCTIONS:
1. SEARCH: Find interesting facts/curiosities.
2. ENGAGE: Make the listener want to visit.
3. FACTS: Use real history/dates.

${getCoreRules()}

${dataContext}${vars.context ? `\nCONTEXT:\n${vars.context}\n` : ''}

TARGET: {{name}} in {{city}}
OUTPUT: Only the text in {{language}}.`

  return replacePlaceholders(template, vars)
}

/**
 * Cultural Style Prompt - COMPRESSED
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

  const template = `ROLE: Cultural Guide
TASK: Explain cultural significance of {{name}}.
LANGUAGE: {{language}} (CRITICAL: Output MUST be in this language).
STYLE: Respectful, deep, informative.

INSTRUCTIONS:
1. SEARCH: Focus on traditions, art, heritage.
2. EXPLAIN: Why is this culturally important?

${getCoreRules()}

TARGET: {{name}} in {{city}}
OUTPUT: Only the text in {{language}}.`

  return replacePlaceholders(template, vars)
}

/**
 * Simple Style Prompt - COMPRESSED
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

  const template = `ROLE: Informative Guide
TASK: Simple {{audioDuration}} description for {{name}}.
LANGUAGE: {{language}} (CRITICAL: Output MUST be in this language).

INSTRUCTIONS:
1. Search for key facts.
2. Be direct and objective.
3. No complex words.

${getCoreRules()}

TARGET: {{name}} in {{city}}
OUTPUT: Only the text in {{language}}.`

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
 * System instruction template - COMPRESSED
 */
export function getSystemInstruction(
  audioDuration: string = '30s',
  maxWords: number = 120
): string {
  return `ROLE: Audio Guide Editor
TASK: Ensure text is verifiable, ${audioDuration}, no hallucinations.
Allow Google Search usage.`
}

