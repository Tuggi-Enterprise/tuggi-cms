/**
 * Authentication Service for Edge Functions
 * 
 * Provides JWT token validation and permission checking
 * Compatible with Supabase Edge Functions
 */

import { createClient } from '@supabase/supabase-js'

// =====================================
// INTERFACES AND TYPES
// =====================================

export interface AuthResult {
  valid: boolean
  user_id?: string
  email?: string
  permissions?: string[]
  rate_limit?: {
    remaining: number
    reset_at: string
  }
  error?: string
}

export interface AuthOptions {
  check_permissions?: boolean
  required_permissions?: string[]
  rate_limit_check?: boolean
}

// =====================================
// MAIN SERVICE CLASS
// =====================================

export class AuthService {
  private static getSupabaseClient() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing required environment variables: SUPABASE_URL and SUPABASE_ANON_KEY')
    }
    
    return createClient(supabaseUrl, supabaseAnonKey, {
      auth: { 
        autoRefreshToken: false, 
        persistSession: false,
        detectSessionInUrl: false // Important for Edge Functions
      }
    })
  }

  /**
   * Validate JWT token and return user information
   */
  static async validateToken(
    token: string, 
    options: AuthOptions = {}
  ): Promise<AuthResult> {
    try {
      if (!token) {
        return {
          valid: false,
          error: 'No token provided'
        }
      }

      // Remove 'Bearer ' prefix if present
      const cleanToken = token.replace(/^Bearer\s+/i, '')
      
      const supabase = this.getSupabaseClient()
      
      // Validate token with Supabase
      const { data: { user }, error } = await supabase.auth.getUser(cleanToken)
      
      if (error || !user) {
        return {
          valid: false,
          error: error?.message || 'Invalid token'
        }
      }

      const result: AuthResult = {
        valid: true,
        user_id: user.id,
        email: user.email
      }

      // Check permissions if requested
      if (options.check_permissions) {
        const permissions = await this.getUserPermissions(user.id)
        result.permissions = permissions
        
        // Check required permissions
        if (options.required_permissions?.length) {
          const hasRequiredPermissions = options.required_permissions.every(
            perm => permissions.includes(perm)
          )
          
          if (!hasRequiredPermissions) {
            return {
              valid: false,
              error: `Missing required permissions: ${options.required_permissions.join(', ')}`
            }
          }
        }
      }

      // Check rate limits if requested
      if (options.rate_limit_check) {
        const rateLimit = await this.checkRateLimit(user.id)
        result.rate_limit = rateLimit
        
        if (rateLimit.remaining <= 0) {
          return {
            valid: false,
            error: `Rate limit exceeded. Resets at: ${rateLimit.reset_at}`
          }
        }
      }

      return result

    } catch (error: any) {
      console.error('❌ Auth validation error:', error)
      return {
        valid: false,
        error: error.message || 'Authentication failed'
      }
    }
  }

  /**
   * Get user permissions from user metadata
   */
  private static async getUserPermissions(userId: string): Promise<string[]> {
    try {
      const supabase = this.getSupabaseClient()
      
      // Get user metadata
      const { data: { user }, error } = await supabase.auth.admin.getUserById(userId)
      
      if (error || !user) {
        console.warn('⚠️ Could not fetch user metadata for permissions')
        return []
      }

      // Extract permissions from user metadata
      const permissions = user.user_metadata?.permissions || []
      const role = user.user_metadata?.role
      
      // Add role-based permissions
      const rolePermissions = this.getRolePermissions(role)
      
      return [...new Set([...permissions, ...rolePermissions])]
      
    } catch (error) {
      console.warn('⚠️ Error fetching user permissions:', error)
      return []
    }
  }

  /**
   * Get permissions based on user role
   */
  private static getRolePermissions(role?: string): string[] {
    const rolePermissions: Record<string, string[]> = {
      'admin': [
        'poi:create', 'poi:read', 'poi:update', 'poi:delete',
        'description:generate', 'description:improve', 'description:validate',
        'trigger-points:generate', 'audio:generate', 'poi:publish'
      ],
      'editor': [
        'poi:read', 'poi:update',
        'description:generate', 'description:improve', 'description:validate',
        'trigger-points:generate', 'audio:generate'
      ],
      'user': [
        'poi:read',
        'description:validate'
      ]
    }
    
    return rolePermissions[role || 'user'] || rolePermissions['user']
  }

  /**
   * Check rate limits for user
   */
  private static async checkRateLimit(userId: string): Promise<{
    remaining: number
    reset_at: string
  }> {
    try {
      // Simple rate limiting logic
      // In production, this could use Redis or a dedicated rate limiting service
      
      const now = new Date()
      const resetTime = new Date(now.getTime() + 60 * 60 * 1000) // Reset in 1 hour
      
      // For now, return generous limits
      // TODO: Implement actual rate limiting logic
      return {
        remaining: 100, // 100 requests per hour
        reset_at: resetTime.toISOString()
      }
      
    } catch (error) {
      console.warn('⚠️ Error checking rate limit:', error)
      return {
        remaining: 10, // Conservative fallback
        reset_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      }
    }
  }

  /**
   * Extract token from Authorization header
   */
  static extractTokenFromHeader(authHeader?: string): string | null {
    if (!authHeader) return null
    
    const match = authHeader.match(/^Bearer\s+(.+)$/i)
    return match ? match[1] : null
  }

  /**
   * Validate request with authentication
   */
  static async validateRequest(
    request: Request,
    options: AuthOptions = {}
  ): Promise<AuthResult> {
    try {
      const authHeader = request.headers.get('Authorization')
      const token = this.extractTokenFromHeader(authHeader)
      
      if (!token) {
        return {
          valid: false,
          error: 'Missing Authorization header'
        }
      }
      
      return await this.validateToken(token, options)
      
    } catch (error: any) {
      return {
        valid: false,
        error: error.message || 'Request validation failed'
      }
    }
  }
}
