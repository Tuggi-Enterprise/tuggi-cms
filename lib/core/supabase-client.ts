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

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

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
  private serviceClient: SupabaseClient | null = null
  private edgeClient: SupabaseClient | null = null
  
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
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for service client')
      }
      this.serviceClient = createClient(config.url, config.serviceRoleKey, {
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
    return createClientComponentClient()
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
      anonKey = deno?.env.get('SUPABASE_ANON_KEY') || deno?.env.get('NEXT_PUBLIC_SUPABASE_ANON_KEY') || ''
      serviceRoleKey = deno?.env.get('SUPABASE_SERVICE_ROLE_KEY')
    } else {
      // Node.js/Next.js environment
      url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
      anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
      serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    }
    
    if (!url || !anonKey) {
      throw new Error(
        `Missing required Supabase environment variables. ` +
        `Required: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY. ` +
        `For service operations: SUPABASE_SERVICE_ROLE_KEY`
      )
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
  }
  
  /**
   * Validate environment variables
   */
  validateEnvironment(): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    
    try {
      const config = this.getConfig('server')
      if (!config.url) errors.push('NEXT_PUBLIC_SUPABASE_URL is missing')
      if (!config.anonKey) errors.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is missing')
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
export const getSupabaseServer = () => SupabaseClientManager.getInstance().getServerClient()

// For admin operations
export const getSupabaseService = () => SupabaseClientManager.getInstance().getServiceClient()

// For Edge Functions
export const getSupabaseEdge = () => SupabaseClientManager.getInstance().getEdgeClient()

// For React components (use this instead of useSupabaseClient)
export const getSupabaseClient = () => SupabaseClientManager.getInstance().getClientComponent()

// For scripts and utilities
export const getSupabase = (type: SupabaseClientType = 'server') => 
  SupabaseClientManager.getInstance().getClient(type)

/**
 * React hook for components (replaces useSupabaseClient)
 */
export const useSupabase = () => {
  return getSupabaseClient()
}

/**
 * Legacy compatibility - maintains existing API
 */
export const supabase = getSupabaseServer()

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
