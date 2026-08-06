/**
 * Supabase Client Manager — the single source of truth for how the CMS talks to
 * the database.
 *
 * There are exactly three ways out of this module, and each one names the identity
 * the request will carry:
 *
 * - `getSupabaseClient()`    browser, cookie-bound → the signed-in operator
 * - `getSupabaseRouteHandler(cookies)` / `getSupabaseServerComponent(cookies)`
 *                            server, cookie-bound → the signed-in operator
 * - `getSupabaseService()`   server only, `service_role` → ignores RLS
 *
 * SEC-37 removed a fourth one. `getServerClient()` / `getSupabase('server')` built a
 * client with the *publishable* key and no cookie, so every query it made reached
 * PostgREST as `anon` — including reads of personal data — while its name said
 * "server" and two call sites commented it as "service role for elevated
 * privileges". There is no anon-without-session client here any more: a call site
 * that has no operator is machine work and says so with `getSupabaseService()`.
 *
 * The publishable key is the only key that may reach the browser. `SUPABASE_SECRET_KEY`
 * is read here and nowhere near a component.
 */

import {
  createClient,
  SupabaseClient
} from '@supabase/supabase-js'

import { createBrowserClient, createServerClient } from '@supabase/ssr'

/**
 * The browser-visible key, by its current name.
 *
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` is the legacy name and is deliberately not read,
 * here or anywhere else in the CMS: it was the fallback that kept the anon surface
 * alive, and a fallback is how a key that should be retired stays in service.
 */
const PUBLISHABLE_KEY = () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ''
const SUPABASE_URL = () => process.env.NEXT_PUBLIC_SUPABASE_URL || ''

// Environment configuration
interface SupabaseConfig {
  url: string
  publishableKey: string
  serviceRoleKey?: string
  isEdgeFunction?: boolean
  isClientSide?: boolean
}

/**
 * Client types for different contexts.
 *
 * `'server'` and `'edge'` are gone (SEC-37): both were the publishable key without a
 * session, i.e. `anon`.
 */
export type SupabaseClientType = 'client' | 'service'

/**
 * Supabase Client Manager - Singleton
 */
export class SupabaseClientManager {
  private static instance: SupabaseClientManager
  private serviceClient: any = null
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
   * Get client component client (for React components)
   */
  getClientComponent(): any {
    // Singleton per browser context. @supabase/ssr's browser client persists the session in
    // cookies and attaches the user's access token to PostgREST/RPC requests. (The old
    // auth-helpers client did NOT attach the token with sb_publishable_ keys, so authenticated
    // queries could silently run as anon.) Memoize so sign-in and later queries share one
    // session and we don't spawn "Multiple GoTrueClient instances".
    if (!this.clientComponent) {
      this.clientComponent = createBrowserClient(SUPABASE_URL(), PUBLISHABLE_KEY())
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
    return createServerClient(SUPABASE_URL(), PUBLISHABLE_KEY(), {
      cookies: this.cookieAdapter(cookies),
    })
  }

  /**
   * Get server component client (for Next.js Server Components)
   */
  getServerComponent(cookies: any): any {
    return createServerClient(SUPABASE_URL(), PUBLISHABLE_KEY(), {
      cookies: this.cookieAdapter(cookies),
    })
  }

  /**
   * Get appropriate client based on context.
   *
   * No default value on purpose: the identity a query runs as is never implicit.
   */
  getClient(type: SupabaseClientType): SupabaseClient {
    switch (type) {
      case 'service':
        return this.getServiceClient()
      case 'client':
        return this.getClientComponent()
      default: {
        const unreachable: never = type
        throw new Error(`Unknown Supabase client type: ${String(unreachable)}`)
      }
    }
  }

  /**
   * Get configuration based on context
   */
  private getConfig(_type: SupabaseClientType): SupabaseConfig {
    const isEdgeFunction = typeof globalThis !== 'undefined' && 'Deno' in globalThis
    const isClientSide = typeof window !== 'undefined'

    let url: string
    let publishableKey: string
    let serviceRoleKey: string | undefined

    if (isEdgeFunction) {
      // Edge Functions environment
      const deno = (globalThis as any).Deno
      url = deno?.env.get('SUPABASE_URL') || deno?.env.get('NEXT_PUBLIC_SUPABASE_URL') || ''
      publishableKey =
        deno?.env.get('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') ||
        deno?.env.get('SUPABASE_PUBLISHABLE_KEY') ||
        ''
      serviceRoleKey = deno?.env.get('SUPABASE_SECRET_KEY')
    } else {
      // Node.js/Next.js environment
      url = SUPABASE_URL()
      publishableKey = PUBLISHABLE_KEY()
      serviceRoleKey =
        process.env.SUPABASE_SECRET_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY
    }

    if (!url || !publishableKey) {
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
      publishableKey,
      serviceRoleKey,
      isEdgeFunction,
      isClientSide
    }
  }

  /**
   * Reset clients (useful for testing)
   */
  reset(): void {
    this.serviceClient = null
    this.clientComponent = null
  }

  /**
   * Validate environment variables
   */
  validateEnvironment(): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    try {
      const config = this.getConfig('client')
      if (!config.url) errors.push('NEXT_PUBLIC_SUPABASE_URL is missing')
      if (!config.publishableKey) errors.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing')
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

// For admin operations. Server only: this client carries SUPABASE_SECRET_KEY and
// ignores RLS, so whoever calls it has already decided who is allowed to.
export const getSupabaseService = () => new Proxy({} as SupabaseClient, {
  get: (target, prop) => {
    return (SupabaseClientManager.getInstance().getServiceClient() as any)[prop]
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

// For scripts and utilities. The type is required — `getSupabase()` used to default
// to the anon-without-session client, which is how a call site got that identity
// without ever naming it. `scripts/check-route-policies.ts` reads `getSupabase('service')`
// as reaching service_role.
export const getSupabase = (type: SupabaseClientType) =>
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
