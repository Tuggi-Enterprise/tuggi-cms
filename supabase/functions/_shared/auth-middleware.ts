/**
 * Authentication Middleware for Supabase Edge Functions
 *
 * Provides secure validation of JWT tokens from Authorization header
 * Supports Bearer token format and validates with Supabase Auth
 *
 * Usage:
 * ```typescript
 * import { validateAuthHeader, requireAuth } from '../_shared/auth-middleware.ts'
 *
 * serve(async (req) => {
 *   // Simple validation (returns result object)
 *   const auth = await validateAuthHeader(req)
 *   if (!auth.valid) {
 *     return new Response(
 *       JSON.stringify({ error: 'Unauthorized' }),
 *       { status: 401, headers: corsHeaders }
 *     )
 *   }
 *
 *   // Or use helper for automatic error response
 *   const authOrError = await requireAuth(req)
 *   if (authOrError instanceof Response) return authOrError
 *   const { userId, email, role } = authOrError
 * })
 * ```
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecretKey } from './supabase-client.ts';

// =====================================
// TYPES
// =====================================

export interface AuthResult {
  valid: boolean;
  userId?: string;
  email?: string;
  role?: string;
  error?: string;
  statusCode?: number;
}

export interface AuthUser {
  userId: string;
  email: string;
  role?: string;
}

// =====================================
// CORS HEADERS (for error responses)
// =====================================

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE, PATCH",
  "Content-Type": "application/json",
};

// =====================================
// MAIN FUNCTIONS
// =====================================

/**
 * Validates Authorization header and returns auth result
 *
 * @param request - Deno request object
 * @returns AuthResult with validity status and user info if valid
 */
export async function validateAuthHeader(
  request: Request,
): Promise<AuthResult> {
  try {
    // 1. Extract Authorization header
    const authHeader = request.headers.get("authorization");

    if (!authHeader) {
      console.warn("❌ Missing Authorization header");
      return {
        valid: false,
        error: "Missing Authorization header",
        statusCode: 401,
      };
    }

    // 2. Extract Bearer token
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      console.warn("❌ Invalid Authorization header format");
      return {
        valid: false,
        error: "Invalid Authorization header format. Expected: Bearer <token>",
        statusCode: 401,
      };
    }

    const token = parts[1];

    if (!token) {
      console.warn("❌ Empty token");
      return {
        valid: false,
        error: "Empty token",
        statusCode: 401,
      };
    }

    // 3. Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = getSecretKey();

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("❌ Missing Supabase environment variables");
      return {
        valid: false,
        error: "Server configuration error",
        statusCode: 500,
      };
    }

    // 3.1 Check if token is the service role key (Internal Bypass)
    // Trim to avoid issues with newlines/spaces from Vault or Env variables
    if (token.trim() === supabaseServiceKey?.trim()) {
      console.log("✅ [Auth] Validated via SERVICE_ROLE_KEY (Internal Bypass)");
      return {
        valid: true,
        userId: "00000000-0000-0000-0000-000000000000",
        email: "system@supabase.internal",
        role: "service_role",
      };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 4. Verify token with Supabase using getUser() — the standard API
    // ✅ FIX: Replaced decodeJWT + getUserById with getUser(token)
    // Reason: @supabase/auth-js@2.102.1+ throws on non-UUID input to getUserById().
    // getUser() validates the JWT cryptographically and works for ALL auth providers
    // (Google OAuth, Apple, email/password) without needing to manually extract sub.
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.warn(
        `❌ Token validation failed: ${error?.message || "Invalid token"}`,
      );
      return {
        valid: false,
        error: "Invalid or expired token",
        statusCode: 401,
      };
    }

    // 5. Optionally check cms_users table for role
    let userRole: string | undefined;

    try {
      const { data: cmsUser, error: roleError } = await supabase
        .schema("core")
        .from("cms_users")
        .select("role")
        .eq("email", user.email)
        .eq("is_active", true)
        .maybeSingle();

      if (!roleError && cmsUser) {
        userRole = cmsUser.role;
      }
    } catch (err) {
      console.warn("⚠️ Could not fetch user role from cms_users:", err);
      // Continue without role - role is optional
    }

    console.log(`✅ Token validated for user: ${user.email} (ID: ${user.id})`);

    return {
      valid: true,
      userId: user.id,
      email: user.email,
      role: userRole,
    };
  } catch (error) {
    console.error("❌ Auth validation error:", error);
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Internal server error",
      statusCode: 500,
    };
  }
}

/**
 * Helper function that returns either an AuthUser object or an error Response
 * Useful for cleaner code in handlers
 *
 * @param request - Deno request object
 * @returns AuthUser object if valid, or Response object if invalid
 */
export async function requireAuth(
  request: Request,
  corsHeaders?: Record<string, string>,
): Promise<AuthUser | Response> {
  const result = await validateAuthHeader(request);

  if (!result.valid) {
    const headers = corsHeaders || {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Content-Type": "application/json",
    };

    return new Response(
      JSON.stringify({
        error: result.error || "Unauthorized",
        timestamp: new Date().toISOString(),
      }),
      {
        status: result.statusCode || 401,
        headers,
      },
    );
  }

  return {
    userId: result.userId!,
    email: result.email!,
    role: result.role,
  };
}

/**
 * Logs authentication events for auditing
 */
export async function logAuthEvent(
  supabaseUrl: string,
  supabaseServiceKey: string,
  eventType:
    | "access_granted"
    | "access_denied"
    | "invalid_token"
    | "missing_token",
  userId?: string,
  email?: string,
  details?: Record<string, any>,
): Promise<void> {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    await supabase
      .schema("core")
      .from("auth_logs")
      .insert({
        event_type: eventType,
        user_id: userId,
        email,
        details,
        created_at: new Date().toISOString(),
      });
  } catch (error) {
    console.warn("⚠️ Could not log auth event:", error);
    // Don't fail the request if logging fails
  }
}

// =====================================
// HELPER FUNCTIONS
// =====================================

/**
 * Decode JWT payload without verification (for extracting user ID)
 * This is safe because we verify the token with Supabase auth
 */
function decodeJWT(token: string): any {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return {};
    }

    let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) {
      base64 += "=";
    }

    const binString = atob(base64);
    const m = new Uint8Array(binString.length);
    for (let i = 0; i < binString.length; i++) {
      m[i] = binString.charCodeAt(i);
    }
    const decodedStr = new TextDecoder().decode(m);

    return JSON.parse(decodedStr);
  } catch (error) {
    console.warn("⚠️ Could not decode JWT:", error);
    return {};
  }
}

/**
 * Check if user has specific role
 */
export function hasRole(
  userRole: string | undefined,
  requiredRole: string | string[],
): boolean {
  if (!userRole) return false;

  if (Array.isArray(requiredRole)) {
    return requiredRole.includes(userRole);
  }

  return userRole === requiredRole;
}

/**
 * Check if user is admin
 */
export function isAdmin(userRole: string | undefined): boolean {
  return userRole === "admin" || userRole === "super_admin";
}

/**
 * Check if user is client
 */
export function isClient(userRole: string | undefined): boolean {
  return userRole === "client";
}
