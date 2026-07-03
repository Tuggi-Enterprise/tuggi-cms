/**
 * Supabase Client Manager - Single Source of Truth
 * 
 * Centralized Supabase client management following DRY and SSOF principles.
 * Eliminates 140+ duplicate Supabase client initializations across the project.
 * 
 * Features:
 * - Singleton pattern for consistent client instances
 * - Environment-specific configurations
 * - Edge Functions compatibility
 * - React hooks integration
 * - Error handling and validation
 */

import { 
  createClient, 
  SupabaseClient 
} from '@supabase/supabase-js'

// --- SSOT BRIDGE ---
// Ensure legacy environment variables exist for backward compatibility with 
// third-party libraries (like @supabase/auth-helpers) that expect them.
if (typeof window !== 'undefined') {
  console.log('🔍 [Supabase] Browser environment variables:', {
    hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasPublishable: !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    hasAnon: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  });
}

if (typeof process !== 'undefined' && process.env) {
  // Bridge for compatibility with 3rd party libs that expect legacy names
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_SECRET_KEY) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SECRET_KEY;
  }
}

import { createBrowserClient, createServerClient } from '@supabase/ssr'

// Environment configuration
interface SupabaseConfig {
  url: string
  anonKey: string
  serviceRoleKey?: string
  isEdgeFunction?: boolean
  isClientSide?: boolean
}

// Client types for different contexts
export type SupabaseClientType = 'server' | 'client' | 'edge' | 'service'

/**
 * Supabase Client Manager - Singleton
 */
export class SupabaseClientManager {
  private static instance: SupabaseClientManager
  private serverClient: SupabaseClient | null = null
  private serviceClient: any = null
  private edgeClient: SupabaseClient | null = null
  private clientComponent: any = null
  
  private constructor() {
    // Private constructor for singleton pattern
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(): SupabaseClientManager {
    if (!SupabaseClientManager.instance) {
      SupabaseClientManager.instance = new SupabaseClientManager()
    }
    return SupabaseClientManager.instance
  }
  
  /**
   * Get server-side client (for API routes and server components)
   */
  getServerClient(): SupabaseClient {
    if (!this.serverClient) {
      const config = this.getConfig('server')
      this.serverClient = createClient(config.url, config.anonKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false
        }
      })
    }
    return this.serverClient
  }
  
  /**
   * Get service role client (for admin operations)
   */
  getServiceClient(): SupabaseClient {
    if (!this.serviceClient) {
      const config = this.getConfig('service')
      if (!config.serviceRoleKey) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('⚠️ SUPABASE_SECRET_KEY is missing for service client')
        }
      }
      this.serviceClient = createClient(config.url, config.serviceRoleKey || '', {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false
        }
      })
    }
    return this.serviceClient
  }
  
  /**
   * Get Edge Function client (for Supabase Edge Functions)
   */
  getEdgeClient(): SupabaseClient {
    if (!this.edgeClient) {
      const config = this.getConfig('edge')
      this.edgeClient = createClient(config.url, config.anonKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false
        }
      })
    }
    return this.edgeClient
  }
  
  /**
   * Get client component client (for React components)
   */
  getClientComponent(): any {
    // Singleton per browser context. @supabase/ssr's browser client persists the session in
    // cookies and attaches the user's access token to PostgREST/RPC requests. (The old
    // auth-helpers client did NOT attach the token with sb_publishable_ keys, so authenticated
    // queries could silently run as anon.) Memoize so sign-in and later queries share one
    // session and we don't spawn "Multiple GoTrueClient instances".
    if (!this.clientComponent) {
      this.clientComponent = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
      )
    }
    return this.clientComponent
  }

  /**
   * Cookie adapter shared by route-handler and server-component clients.
   * setAll is a no-op when the caller can't write cookies (e.g. Server Components); the
   * try/catch swallows the Next.js "cookies can only be modified..." error in that context.
   */
  private cookieAdapter(cookieStore: any) {
    return {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet: { name: string; value: string; options?: any }[]) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch { /* read-only cookie context (RSC) */ }
      },
    }
  }

  /**
   * Get route handler client (for Next.js API Routes/Route Handlers)
   */
  getRouteHandler(cookies: any): any {
    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      { cookies: this.cookieAdapter(cookies) }
    )
  }

  /**
   * Get server component client (for Next.js Server Components)
   */
  getServerComponent(cookies: any): any {
    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      { cookies: this.cookieAdapter(cookies) }
    )
  }
  
  /**
   * Get appropriate client based on context
   */
  getClient(type: SupabaseClientType = 'server'): SupabaseClient {
    switch (type) {
      case 'server':
        return this.getServerClient()
      case 'service':
        return this.getServiceClient()
      case 'edge':
        return this.getEdgeClient()
      case 'client':
        return this.getClientComponent()
      default:
        return this.getServerClient()
    }
  }
  
  /**
   * Get configuration based on context
   */
  private getConfig(type: SupabaseClientType): SupabaseConfig {
    const isEdgeFunction = typeof globalThis !== 'undefined' && 'Deno' in globalThis
    const isClientSide = typeof window !== 'undefined'
    
    let url: string
    let anonKey: string
    let serviceRoleKey: string | undefined
    
    if (isEdgeFunction) {
      // Edge Functions environment
      const deno = (globalThis as any).Deno
      url = deno?.env.get('SUPABASE_URL') || deno?.env.get('NEXT_PUBLIC_SUPABASE_URL') || ''
      anonKey = 
        deno?.env.get('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') || 
        deno?.env.get('SUPABASE_PUBLISHABLE_KEY') || 
        deno?.env.get('SUPABASE_ANON_KEY') || 
        ''
      serviceRoleKey = 
        deno?.env.get('SUPABASE_SECRET_KEY') || 
        deno?.env.get('SUPABASE_SECRET_KEY')
    } else {
      // Node.js/Next.js environment
      url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
      anonKey = 
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 
        ''
      serviceRoleKey = 
        process.env.SUPABASE_SECRET_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY
    }
    
    if (!url || !anonKey) {
      // Don't throw during module evaluation/build time. 
      // createClient will be called with empty strings, and 
      // actual errors will happen at runtime when requests are made.
      if (process.env.NODE_ENV === 'development') {
        console.warn(
          `⚠️ Supabase environment variables missing. ` +
          `Requests will fail until NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are set.`
        )
      }
    }
    
    return {
      url,
      anonKey,
      serviceRoleKey,
      isEdgeFunction,
      isClientSide
    }
  }
  
  /**
   * Reset clients (useful for testing)
   */
  reset(): void {
    this.serverClient = null
    this.serviceClient = null
    this.edgeClient = null
    this.clientComponent = null
  }
  
  /**
   * Validate environment variables
   */
  validateEnvironment(): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    
    try {
      const config = this.getConfig('server')
      if (!config.url) errors.push('NEXT_PUBLIC_SUPABASE_URL is missing')
      if (!config.anonKey) errors.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing')
    } catch (error) {
      errors.push(`Configuration error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
    
    return {
      valid: errors.length === 0,
      errors
    }
  }
}

/**
 * Convenience functions for common use cases
 */

// For API routes and server components
export const getSupabaseServer = () => new Proxy({} as SupabaseClient, {
  get: (target, prop) => {
    return (SupabaseClientManager.getInstance().getServerClient() as any)[prop]
  }
})

// For admin operations
export const getSupabaseService = () => new Proxy({} as SupabaseClient, {
  get: (target, prop) => {
    return (SupabaseClientManager.getInstance().getServiceClient() as any)[prop]
  }
})

// For Edge Functions
export const getSupabaseEdge = () => new Proxy({} as SupabaseClient, {
  get: (target, prop) => {
    return (SupabaseClientManager.getInstance().getEdgeClient() as any)[prop]
  }
})

// For React components (returns a new instance each call as per auth-helpers)
export const getSupabaseClient = () => SupabaseClientManager.getInstance().getClientComponent()

// For Route Handlers (API routes)
export const getSupabaseRouteHandler = (cookies: any) => 
  SupabaseClientManager.getInstance().getRouteHandler(cookies)

// For Server Components
export const getSupabaseServerComponent = (cookies: any) => 
  SupabaseClientManager.getInstance().getServerComponent(cookies)

// For scripts and utilities
export const getSupabase = (type: SupabaseClientType = 'server') => 
  new Proxy({} as SupabaseClient, {
    get: (target, prop) => {
      return (SupabaseClientManager.getInstance().getClient(type) as any)[prop]
    }
  })

/**
 * React hook for components (replaces useSupabaseClient)
 */
export const useSupabase = () => {
  return getSupabaseClient()
}

/**
 * Legacy compatibility - maintains existing API
 */
export const supabase = new Proxy({} as SupabaseClient, {
  get: (target, prop) => {
    return (getSupabaseServer() as any)[prop]
  }
})

/**
 * Database types (moved from lib/supabase.ts)
 */
export interface CmsUser {
  id: string
  email: string
  role: string
  created_at: string
  updated_at: string
}

export interface Database {
  public: {
    Tables: {
      attractions: {
        Row: {
          id: string
          name: string
          description: string | null
          latitude: number
          longitude: number
          city: string
          state: string
          country: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          latitude: number
          longitude: number
          city: string
          state: string
          country: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          latitude?: number
          longitude?: number
          city?: string
          state?: string
          country?: string
          created_at?: string
          updated_at?: string
        }
      }
    }
  }
}
