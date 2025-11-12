import { GoogleGenerativeAI } from '@google/generative-ai'

// Rate limiting configuration
const RATE_LIMITS = {
  'gemini-2.5-flash': {
    requestsPerMinute: 15, // Flash é mais rápido e permite mais requests
    requestsPerHour: 1500,
    cooldownMs: 4000 // Menos cooldown para Flash
  },
  'gemini-2.5-flash-lite': {
    requestsPerMinute: 20, // Flash-Lite permite ainda mais requests
    requestsPerHour: 2000,
    cooldownMs: 3000
  }
}

// In-memory rate limiting store
const rateLimitStore = new Map<string, {
  requests: number[]
  lastRequest: number
}>()

export async function callGeminiAPI(
  model: keyof typeof RATE_LIMITS,
  prompt: string,
  operation: string
): Promise<any> {
  const now = Date.now()
  const limit = RATE_LIMITS[model]
  
  if (!limit) {
    throw new Error(`Unknown model: ${model}`)
  }

  // Check rate limits
  const key = `${model}:${operation}`
  const store = rateLimitStore.get(key) || { requests: [], lastRequest: 0 }
  
  // Clean old requests
  const oneMinuteAgo = now - 60000
  const oneHourAgo = now - 3600000
  store.requests = store.requests.filter(time => time > oneMinuteAgo)
  
  // Check minute limit
  if (store.requests.length >= limit.requestsPerMinute) {
    const oldestRequest = Math.min(...store.requests)
    const waitTime = 60000 - (now - oldestRequest)
    throw new Error(`Rate limit exceeded. Try again in ${Math.ceil(waitTime / 1000)} seconds.`)
  }
  
  // Check cooldown - AGUARDAR automaticamente ao invés de falhar
  if (now - store.lastRequest < limit.cooldownMs) {
    const waitTime = limit.cooldownMs - (now - store.lastRequest)
    console.log(`⏳ Cooldown period. Waiting ${Math.ceil(waitTime / 1000)} seconds...`)
    await new Promise(resolve => setTimeout(resolve, waitTime))
  }
  
  // Update rate limit store
  store.requests.push(now)
  store.lastRequest = now
  rateLimitStore.set(key, store)
  
      // Initialize Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const geminiModel = genAI.getGenerativeModel({ model })
  
  try {
    console.log(`🤖 Calling Gemini API (${model}) for ${operation}...`)
    
    const result = await geminiModel.generateContent(prompt)
    const response = await result.response
    const text = response.text()
    
    console.log(`✅ Gemini API call successful`)
    
    // Try to parse JSON from the response
    try {
      // Look for JSON in code blocks first
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || 
                       text.match(/```\n([\s\S]*?)\n```/) || 
                       text.match(/\{[\s\S]*\}/)
      
      if (jsonMatch) {
        const jsonString = jsonMatch[1] || jsonMatch[0]
        const cleanedJsonString = jsonString
          .replace(/```json/g, '')
          .replace(/```/g, '')
          .trim()
        
        return JSON.parse(cleanedJsonString)
      } else {
        // If no JSON found, return the raw text
        console.log(`⚠️ No JSON found in response, returning raw text`)
        return { text: text }
      }
    } catch (parseError) {
      console.error(`❌ Failed to parse JSON from Gemini response:`, parseError)
      console.log(`📝 Raw response:`, text.substring(0, 500) + '...')
      return { text: text, error: 'JSON parsing failed' }
    }
    
  } catch (error) {
    console.error(`❌ Gemini API call failed:`, error)
    
    // Remove the request from rate limit if it failed
    store.requests = store.requests.filter(time => time !== now)
    rateLimitStore.set(key, store)
    
    throw error
  }
}

export function getRateLimitStatus(model: keyof typeof RATE_LIMITS, operation: string) {
  const key = `${model}:${operation}`
  const store = rateLimitStore.get(key)
  
  if (!store) {
    return {
      requestsInLastMinute: 0,
      requestsInLastHour: 0,
      lastRequest: null,
      limit: RATE_LIMITS[model]
    }
  }
  
  const now = Date.now()
  const oneMinuteAgo = now - 60000
  const oneHourAgo = now - 3600000
  
  return {
    requestsInLastMinute: store.requests.filter(time => time > oneMinuteAgo).length,
    requestsInLastHour: store.requests.filter(time => time > oneHourAgo).length,
    lastRequest: store.lastRequest,
    limit: RATE_LIMITS[model]
  }
}
