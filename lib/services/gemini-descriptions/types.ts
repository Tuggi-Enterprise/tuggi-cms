/**
 * Types and Interfaces for Gemini Description Service
 * 
 * Reuses POIData from existing description service for compatibility
 */

// Re-export POIData from existing service for compatibility
export type { POIData } from '../poi-processing/description.service'

/**
 * Options for Gemini Description Service
 */
export interface GeminiDescriptionOptions {
  /** Language code (default: 'pt-br') */
  language?: string
  
  /** Gemini model to use (default: 'gemini-2.5-flash-lite') */
  model?: 'gemini-2.5-flash-lite' | 'gemini-2.5-flash' | 'gemini-2.5-pro'
  
  /** Prompt style/template to use */
  style?: 'touristic' | 'historical' | 'cultural' | 'simple'
  
  /** Maximum words in description (default: 120) */
  maxWords?: number
  
  /** Audio duration target (default: '30s') */
  audioDuration?: string
  
  /** Temperature for generation (0.0-1.0, default: 0.7) */
  temperature?: number
  
  /** Top-K sampling (default: 40) */
  topK?: number
  
  /** Top-P sampling (default: 0.8) */
  topP?: number
  
  /** Maximum output tokens (default: 8192) */
  maxTokens?: number
  
  /** Custom prompt template (overrides style) */
  customPrompt?: string
  
  /** Additional context to include in prompt */
  additionalContext?: string
  
  /** Existing description to improve/enhance (avoids repetition) */
  existingDescription?: string
  
  /** User ID for tracking */
  user_id?: string
  
  /** Request ID for tracking */
  request_id?: string
  
  /** Whether to validate the generated description */
  validate?: boolean
  
  /** System instruction override */
  systemInstruction?: string
}

/**
 * Result from Gemini Description Service
 * Compatible with DescriptionResult from existing service
 */
export interface GeminiDescriptionResult {
  success: boolean
  description?: string
  error?: string
  processing_time: number
  metadata: {
    step: string
    model_used?: string
    tokens_consumed?: number
    quality_score?: number
    status: 'pending' | 'processing' | 'completed' | 'failed'
    user_id?: string
    request_id?: string
    timestamp: string
    prompt_length?: number
    response_length?: number
    word_count?: number
    max_words?: number
    audio_duration?: string
    estimated_audio_duration?: number
  }
  validation?: {
    aprovada: boolean
    pontuacao: number
    problemas: string[]
    sugestoes_melhoria: string
  }
}

/**
 * Prompt Template Structure
 */
export interface PromptTemplate {
  /** Template name/identifier */
  name: string
  
  /** Template description */
  description: string
  
  /** Template content with placeholders */
  template: string
  
  /** Default values for placeholders */
  defaults?: Record<string, any>
  
  /** Variables that must be provided */
  required?: string[]
}

/**
 * Gemini API Request Configuration
 */
export interface GeminiRequestConfig {
  model: string
  prompt: string
  systemInstruction?: string
  generationConfig: {
    temperature: number
    topK: number
    topP: number
    maxOutputTokens: number // Correct field name for REST API
    candidateCount?: number
  }
}

/**
 * Gemini API Response Structure
 */
export interface GeminiAPIResponse {
  candidates?: Array<{
    content: {
      parts: Array<{
        text: string
      }>
    }
    finishReason?: string
    safetyRatings?: any[]
  }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
  error?: {
    code: number
    message: string
    status: string
  }
}

