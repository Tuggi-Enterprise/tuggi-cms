/**
 * Configuration for Gemini Description Service
 * 
 * Centralized configuration for models, parameters, and behavior
 */

/**
 * Available Gemini models and their configurations
 */
export const GEMINI_MODELS = {
  'gemini-2.5-flash-lite': {
    name: 'gemini-2.5-flash-lite',
    displayName: 'Gemini 2.5 Flash Lite',
    maxTokens: 8192,
    recommendedFor: ['simple', 'touristic'],
    rateLimit: {
      requestsPerMinute: 20,
      requestsPerHour: 2000,
      cooldownMs: 3000
    }
  },
  'gemini-2.5-flash': {
    name: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    maxTokens: 8192,
    recommendedFor: ['historical', 'cultural'],
    rateLimit: {
      requestsPerMinute: 15,
      requestsPerHour: 1500,
      cooldownMs: 4000
    }
  },
  'gemini-2.5-pro': {
    name: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    maxTokens: 8192,
    recommendedFor: ['complex', 'detailed'],
    rateLimit: {
      requestsPerMinute: 10,
      requestsPerHour: 1000,
      cooldownMs: 5000
    }
  }
} as const

/**
 * Default generation parameters
 */
export const DEFAULT_GENERATION_CONFIG = {
  temperature: 0.7,
  topK: 40,
  topP: 0.8,
  maxOutputTokens: 8192, // Correct field name for REST API (not maxTokens)
  candidateCount: 1
}

/**
 * Default service configuration
 */
export const DEFAULT_CONFIG = {
  model: 'gemini-2.5-flash-lite' as const,
  style: 'touristic' as const,
  language: 'pt-br',
  maxWords: 120,
  audioDuration: '30s',
  temperature: 0.7,
  topK: 40,
  topP: 0.8,
  maxTokens: 8192,
  validate: true,
  timeout: 30000, // 30 seconds
  maxRetries: 3,
  retryDelay: 1000 // 1 second
}

/**
 * API Configuration
 */
export const API_CONFIG = {
  baseUrl: 'https://generativelanguage.googleapis.com/v1',
  endpoint: (model: string) => `models/${model}:generateContent`,
  timeout: 30000,
  maxRetries: 3,
  retryDelay: 1000
}

/**
 * Get API key from environment
 */
export function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY
  
  if (!apiKey) {
    throw new Error(
      'Gemini API key not configured. ' +
      'Please set GEMINI_API_KEY or GOOGLE_GEMINI_API_KEY environment variable.'
    )
  }
  
  return apiKey
}

/**
 * Get model configuration
 */
export function getModelConfig(model: keyof typeof GEMINI_MODELS) {
  const config = GEMINI_MODELS[model]
  if (!config) {
    throw new Error(`Unknown model: ${model}`)
  }
  return config
}

/**
 * Get generation config with overrides
 */
export function getGenerationConfig(overrides?: {
  temperature?: number
  topK?: number
  topP?: number
  maxTokens?: number
}) {
  return {
    ...DEFAULT_GENERATION_CONFIG,
    ...overrides
  }
}

