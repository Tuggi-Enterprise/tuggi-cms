/**
 * Gemini Description Service
 * 
 * Clean and simple module for generating POI descriptions using Gemini via Google AI Studio
 * Designed to be reusable in other contexts
 */

import type { POIData, GeminiDescriptionOptions, GeminiDescriptionResult, GeminiRequestConfig, GeminiAPIResponse } from './types'
import { DEFAULT_CONFIG, getApiKey, getModelConfig, getGenerationConfig, API_CONFIG, GEMINI_MODELS } from './config'
import { getPromptByStyle, getSystemInstruction } from './prompts'

/**
 * Rate limiting store (in-memory)
 */
const rateLimitStore = new Map<string, {
  requests: number[]
  lastRequest: number
}>()

/**
 * Check and enforce rate limits
 */
async function checkRateLimit(model: keyof typeof GEMINI_MODELS, operation: string = 'generate'): Promise<void> {
  const modelConfig = GEMINI_MODELS[model]
  if (!modelConfig) {
    throw new Error(`Unknown model: ${model}`)
  }
  
  const now = Date.now()
  const key = `${model}:${operation}`
  const store = rateLimitStore.get(key) || { requests: [], lastRequest: 0 }
  const limit = modelConfig.rateLimit
  
  // Clean old requests
  const oneMinuteAgo = now - 60000
  store.requests = store.requests.filter(time => time > oneMinuteAgo)
  
  // Check minute limit
  if (store.requests.length >= limit.requestsPerMinute) {
    const oldestRequest = Math.min(...store.requests)
    const waitTime = 60000 - (now - oldestRequest)
    throw new Error(`Rate limit exceeded. Try again in ${Math.ceil(waitTime / 1000)} seconds.`)
  }
  
  // Check cooldown - wait automatically instead of failing
  if (now - store.lastRequest < limit.cooldownMs) {
    const waitTime = limit.cooldownMs - (now - store.lastRequest)
    console.log(`⏳ Cooldown period. Waiting ${Math.ceil(waitTime / 1000)} seconds...`)
    await new Promise(resolve => setTimeout(resolve, waitTime))
  }
  
  // Update rate limit store
  store.requests.push(now)
  store.lastRequest = now
  rateLimitStore.set(key, store)
}

/**
 * Gemini Description Service
 * 
 * Static class for generating descriptions using Gemini API
 */
export class GeminiDescriptionService {
  
  /**
   * Generate description for a POI
   */
  static async generate(
    poiData: POIData,
    options: GeminiDescriptionOptions = {}
  ): Promise<GeminiDescriptionResult> {
    const startTime = Date.now()
    const requestId = options.request_id || `gemini_desc_${Date.now()}`
    
    try {
      // Validate required fields
      if (!poiData.name) {
        return {
          success: false,
          error: 'POI name is required',
          processing_time: Date.now() - startTime,
          metadata: {
            step: 'validation',
            status: 'failed',
            user_id: options.user_id,
            request_id: requestId,
            timestamp: new Date().toISOString()
          }
        }
      }
      
      // Merge options with defaults
      const config = {
        ...DEFAULT_CONFIG,
        ...options,
        language: options.language || DEFAULT_CONFIG.language,
        model: options.model || DEFAULT_CONFIG.model,
        style: options.style || DEFAULT_CONFIG.style,
        maxWords: options.maxWords || DEFAULT_CONFIG.maxWords,
        audioDuration: options.audioDuration || DEFAULT_CONFIG.audioDuration
      }
      
      // Get prompt based on style or use custom prompt
      const prompt = options.customPrompt 
        ? options.customPrompt
        : getPromptByStyle(config.style, poiData, {
            maxWords: config.maxWords,
            audioDuration: config.audioDuration,
            language: config.language,
            additionalContext: options.additionalContext,
            existingDescription: options.existingDescription
          })
      
      // Get system instruction
      const systemInstruction = options.systemInstruction || 
        getSystemInstruction(config.audioDuration, config.maxWords)
      
      // Generate description
      const description = await this.generateWithPrompt(prompt, {
        ...config,
        systemInstruction,
        request_id: requestId
      })
      
      if (!description) {
        return {
          success: false,
          error: 'Failed to generate description',
          processing_time: Date.now() - startTime,
          metadata: {
            step: 'generation',
            status: 'failed',
            model_used: config.model,
            user_id: options.user_id,
            request_id: requestId,
            timestamp: new Date().toISOString()
          }
        }
      }
      
      // Validate if requested
      let validation = undefined
      if (config.validate) {
        validation = await this.validate(description, poiData.name)
      }
      
      // Calculate word count and estimated audio duration
      const wordCount = description.split(/\s+/).filter(word => word.length > 0).length
      // Average reading speed: ~4 words per second for Portuguese audio narration
      const estimatedAudioDuration = Math.ceil(wordCount / 4)
      const audioDurationSeconds = parseInt(config.audioDuration.replace('s', '')) || 30
      
      const result: GeminiDescriptionResult = {
        success: true,
        description,
        processing_time: Date.now() - startTime,
        metadata: {
          step: 'description_generation',
          model_used: config.model,
          status: 'completed',
          user_id: options.user_id,
          request_id: requestId,
          timestamp: new Date().toISOString(),
          prompt_length: prompt.length,
          response_length: description.length,
          word_count: wordCount,
          max_words: config.maxWords,
          audio_duration: config.audioDuration,
          estimated_audio_duration: estimatedAudioDuration
        },
        validation
      }
      
      return result
      
    } catch (error: any) {
      console.error('❌ Error generating description:', error)
      return {
        success: false,
        error: error.message || 'Unknown error occurred',
        processing_time: Date.now() - startTime,
        metadata: {
          step: 'exception_handling',
          status: 'failed',
          user_id: options.user_id,
          request_id: requestId,
          timestamp: new Date().toISOString()
        }
      }
    }
  }
  
  /**
   * Generate description with custom prompt
   */
  static async generateWithPrompt(
    prompt: string,
    options: GeminiDescriptionOptions & { systemInstruction?: string } = {}
  ): Promise<string | null> {
    const startTime = Date.now()
    
    try {
      // Get API key
      const apiKey = getApiKey()
      
      // Get model configuration
      const model = options.model || DEFAULT_CONFIG.model
      const modelConfig = getModelConfig(model)
      
      // Get generation config
      const generationConfig = getGenerationConfig({
        temperature: options.temperature,
        topK: options.topK,
        topP: options.topP,
        maxTokens: options.maxTokens || modelConfig.maxTokens
      })
      
      // Build request
      const requestConfig: GeminiRequestConfig = {
        model: modelConfig.name,
        prompt,
        systemInstruction: options.systemInstruction,
        generationConfig
      }
      
      // Call Gemini API using rate limiter
      // Note: rate limiter uses SDK, but we'll use REST API directly for more control
      const response = await this.callGeminiRESTAPI(apiKey, requestConfig)
      
      if (!response || !response.description) {
        return null
      }
      
      return response.description
      
    } catch (error: any) {
      console.error('❌ Error in generateWithPrompt:', error)
      throw error
    }
  }
  
  /**
   * Call Gemini REST API directly
   * Uses REST API for more control and compatibility with Google AI Studio
   * Includes rate limiting
   */
  private static async callGeminiRESTAPI(
    apiKey: string,
    config: GeminiRequestConfig
  ): Promise<{ description: string; tokens?: number }> {
    // Check rate limits before making request
    await checkRateLimit(config.model as keyof typeof GEMINI_MODELS, 'generate')
    
    const endpoint = `${API_CONFIG.baseUrl}/${API_CONFIG.endpoint(config.model)}?key=${apiKey}`
    
    // Build request body
    // Note: For REST API, we need to use correct field names
    // - maxTokens -> maxOutputTokens
    // - systemInstruction may not be supported for all models, so we prepend to prompt
    const generationConfig = {
      temperature: config.generationConfig.temperature,
      topK: config.generationConfig.topK,
      topP: config.generationConfig.topP,
      maxOutputTokens: config.generationConfig.maxOutputTokens, // Correct field name
      candidateCount: config.generationConfig.candidateCount || 1
    }
    
    // If systemInstruction is provided, prepend it to the prompt
    // (REST API may not support systemInstruction for all models)
    const finalPrompt = config.systemInstruction 
      ? `${config.systemInstruction}\n\n${config.prompt}`
      : config.prompt
    
    const requestBody: any = {
      contents: [{
        parts: [{
          text: finalPrompt
        }]
      }],
      generationConfig
    }
    
    console.log(`🤖 Calling Gemini API: ${config.model}`)
    console.log(`📝 Prompt length: ${config.prompt.length} characters`)
    
    // Make request with retry logic
    let lastError: Error | null = null
    const maxRetries = API_CONFIG.maxRetries
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = API_CONFIG.retryDelay * attempt
          console.log(`🔄 Retry attempt ${attempt}/${maxRetries} after ${delay}ms...`)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(API_CONFIG.timeout)
        })
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }))
          throw new Error(`Gemini API error ${response.status}: ${errorData.error?.message || response.statusText}`)
        }
        
        const data: GeminiAPIResponse = await response.json()
        
        // Check for errors in response
        if (data.error) {
          throw new Error(`Gemini API error: ${data.error.message}`)
        }
        
        // Extract description from response
        if (!data.candidates || data.candidates.length === 0) {
          throw new Error('No candidates in Gemini response')
        }
        
        const candidate = data.candidates[0]
        
        // Check finish reason
        if (candidate.finishReason === 'MAX_TOKENS') {
          console.warn('⚠️ Response hit MAX_TOKENS limit')
        }
        
        if (candidate.finishReason === 'SAFETY') {
          throw new Error('Content blocked by safety filters')
        }
        
        // Extract text
        const text = candidate.content?.parts?.[0]?.text
        
        if (!text) {
          throw new Error('No text content in Gemini response')
        }
        
        const description = text.trim()
        const tokens = data.usageMetadata?.totalTokenCount
        
        console.log(`✅ Successfully generated description (${description.length} chars, ${tokens || 'unknown'} tokens)`)
        
        return { description, tokens }
        
      } catch (error: any) {
        lastError = error
        
        // Don't retry on certain errors
        if (error.name === 'AbortError' || error.message?.includes('SAFETY')) {
          throw error
        }
        
        // Remove from rate limit store if request failed
        if (error.message?.includes('Rate limit')) {
          const key = `${config.model}:generate`
          const store = rateLimitStore.get(key)
          if (store) {
            store.requests.pop() // Remove failed request
            rateLimitStore.set(key, store)
          }
        }
        
        if (attempt < maxRetries) {
          console.warn(`⚠️ Attempt ${attempt + 1} failed:`, error.message)
          continue
        }
      }
    }
    
    throw lastError || new Error('Failed to generate description after retries')
  }
  
  /**
   * Validate generated description
   * Simplified validation compared to existing service
   */
  static async validate(
    description: string,
    poiName: string
  ): Promise<{
    aprovada: boolean
    pontuacao: number
    problemas: string[]
    sugestoes_melhoria: string
  }> {
    try {
      // Simple validation: check basic requirements
      const problemas: string[] = []
      let pontuacao = 100
      
      // Check length
      const wordCount = description.split(/\s+/).length
      if (wordCount > 150) {
        problemas.push('Descrição muito longa')
        pontuacao -= 20
      }
      if (wordCount < 20) {
        problemas.push('Descrição muito curta')
        pontuacao -= 20
      }
      
      // Check for prohibited content
      const prohibitedPatterns = [
        /\d{2,4}\s*-\s*\d{2,4}/, // Phone numbers
        /R\$|preço|valor|entrada/i, // Prices
        /segunda|terça|quarta|quinta|sexta|sábado|domingo.*\d{1,2}h/i, // Hours
      ]
      
      prohibitedPatterns.forEach(pattern => {
        if (pattern.test(description)) {
          problemas.push('Contém informações proibidas (telefone, preço, horário)')
          pontuacao -= 30
        }
      })
      
      // Check for basic quality
      if (!description.includes(poiName)) {
        problemas.push('Não menciona o nome do POI')
        pontuacao -= 10
      }
      
      const aprovada = pontuacao >= 60 && problemas.length === 0
      
      return {
        aprovada,
        pontuacao: Math.max(0, pontuacao),
        problemas,
        sugestoes_melhoria: problemas.length > 0 
          ? 'Revise a descrição para remover informações proibidas e ajustar o tamanho'
          : 'Descrição atende aos critérios básicos'
      }
      
    } catch (error: any) {
      console.error('❌ Error validating description:', error)
      return {
        aprovada: false,
        pontuacao: 0,
        problemas: ['Erro na validação'],
        sugestoes_melhoria: 'Não foi possível validar a descrição'
      }
    }
  }
}

