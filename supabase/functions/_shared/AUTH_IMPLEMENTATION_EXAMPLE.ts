/**
 * EXAMPLE: Protected Edge Function with Bearer Token Authentication
 * 
 * This is a TEMPLATE showing how to protect edge functions with authentication
 * Copy this pattern and apply to all 18 edge functions
 * 
 * Changes needed:
 * 1. Import auth-middleware at the top
 * 2. Add validateAuthHeader() after CORS check
 * 3. Return 401 if auth fails
 * 4. (Optional) Use requireAuth() helper for cleaner code
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateAuthHeader, requireAuth, corsHeaders, logAuthEvent } from '../_shared/auth-middleware.ts'

const PROJECT_URL = Deno.env.get('PROJECT_URL') || ''
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || ''

const supabaseAdmin = createClient(PROJECT_URL, SERVICE_ROLE_KEY)

interface RequestBody {
  attractionId: string
  audioData: string
  mimeType: string
  language?: string
}

// ════════════════════════════════════════════════════════════════════════════════
// OPTION 1: Using validateAuthHeader (more control)
// ════════════════════════════════════════════════════════════════════════════════

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ✅ NEW: Validate authentication
    const authResult = await validateAuthHeader(req)
    if (!authResult.valid) {
      console.log(`❌ Unauthorized request: ${authResult.error}`)
      
      // Optionally log the failed auth attempt
      if (Deno.env.get('SUPABASE_URL')) {
        await logAuthEvent(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
          'access_denied',
          undefined,
          undefined,
          { error: authResult.error }
        ).catch(err => console.warn('Could not log auth event:', err))
      }

      return new Response(
        JSON.stringify({
          error: 'Unauthorized',
          detail: authResult.error,
          timestamp: new Date().toISOString()
        }),
        {
          status: authResult.statusCode || 401,
          headers: corsHeaders
        }
      )
    }

    // ✅ At this point, user is authenticated
    console.log(`✅ Authenticated request from: ${authResult.email} (${authResult.userId})`)
    console.log(`   Role: ${authResult.role || 'unknown'}`)

    // Parse request body
    const body: RequestBody = await req.json()

    // Validate required fields
    if (!body.attractionId || !body.audioData || !body.mimeType) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: corsHeaders }
      )
    }

    // ✅ Continue with normal function logic
    console.log(`Processing for attraction: ${body.attractionId}`)

    // Store audio in Supabase Storage
    // ... rest of your function logic

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Audio stored successfully',
        userId: authResult.userId
      }),
      { status: 200, headers: corsHeaders }
    )

  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      }),
      { status: 500, headers: corsHeaders }
    )
  }
})

// ════════════════════════════════════════════════════════════════════════════════
// OPTION 2: Using requireAuth helper (cleaner code)
// ════════════════════════════════════════════════════════════════════════════════

/*
serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ✅ NEW: Validate authentication (returns error Response automatically)
    const authOrError = await requireAuth(req, corsHeaders)
    if (authOrError instanceof Response) {
      return authOrError
    }

    const { userId, email, role } = authOrError

    // ✅ At this point, user is authenticated and ready to use
    console.log(`✅ Authenticated request from: ${email} (${userId}) - Role: ${role || 'unknown'}`)

    // Parse request body
    const body: RequestBody = await req.json()

    // Validate required fields
    if (!body.attractionId || !body.audioData || !body.mimeType) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: corsHeaders }
      )
    }

    // ✅ Continue with normal function logic
    console.log(`Processing for attraction: ${body.attractionId}`)

    // ... rest of your function logic

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Audio stored successfully',
        userId
      }),
      { status: 200, headers: corsHeaders }
    )

  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      }),
      { status: 500, headers: corsHeaders }
    )
  }
})
*/

// ════════════════════════════════════════════════════════════════════════════════
// OPTION 3: Role-based access control
// ════════════════════════════════════════════════════════════════════════════════

/*
import { isAdmin, hasRole } from '../_shared/auth-middleware.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authOrError = await requireAuth(req, corsHeaders)
    if (authOrError instanceof Response) {
      return authOrError
    }

    const { userId, email, role } = authOrError

    // ✅ Example: Only allow admins
    if (!isAdmin(role)) {
      return new Response(
        JSON.stringify({
          error: 'Forbidden',
          detail: 'Only administrators can access this function'
        }),
        { status: 403, headers: corsHeaders }
      )
    }

    // ✅ Continue with admin-only logic
    console.log(`✅ Admin request from: ${email}`)

    return new Response(
      JSON.stringify({ success: true, admin: true }),
      { status: 200, headers: corsHeaders }
    )

  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: corsHeaders }
    )
  }
})
*/
