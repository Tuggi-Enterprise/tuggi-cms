import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getSecretKey } from './secret-key.ts'

/**
 * Supabase Client Manager - Single Source of Truth (Edge Functions)
 *
 * Centralises client creation. The secret key itself is resolved in ONE place,
 * `_shared/secret-key.ts` — this module only re-exports it so that callers that
 * already import from here keep working (#155).
 */

// Re-export, not a second definition: `secret-key.ts` owns the resolution.
export { getSecretKey, SECRET_KEY_NAME } from './secret-key.ts'

export function getEnvVar(key: string): string {
  return Deno.env.get(key) || '';
}

export function getSupabaseUrl(): string {
  return getEnvVar('SUPABASE_URL') || getEnvVar('PROJECT_URL') || '';
}

export function getPublishableKey(): string {
  return getEnvVar('TUGGI_PUBLISHABLE_KEY') || 
         getEnvVar('API_PUBLISHABLE_KEY') ||
         '';
}

/**
 * Cria um client com privilégios administrativos usando a Secret Key.
 * Substitui o antigo cliente criado com SERVICE_ROLE_KEY.
 */
export function createAdminClient() {
  const url = getSupabaseUrl();
  const key = getSecretKey();
  
  if (!url || !key) {
    console.warn("⚠️ Aviso: Falha ao criar Supabase Admin Client. URL ou Secret Key não encontrados.");
  }
  
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });
}

/**
 * Cria um client anônimo usando a Publishable Key.
 * Substitui o antigo cliente criado com ANON_KEY.
 */
export function createAnonClient() {
  const url = getSupabaseUrl();
  const key = getPublishableKey();
  
  if (!url || !key) {
    console.warn("⚠️ Aviso: Falha ao criar Supabase Anon Client. URL ou Publishable Key não encontrados.");
  }
  
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });
}
