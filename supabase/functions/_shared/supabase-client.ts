import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

/**
 * Supabase Client Manager - Single Source of Truth (Edge Functions)
 * 
 * Centraliza a resolução de chaves e a criação do client do Supabase 
 * para lidar automaticamente com a migração das chaves legadas 
 * (SERVICE_ROLE_KEY / ANON_KEY) para as novas chaves de API 
 * (SUPABASE_SECRET_KEY / SUPABASE_PUBLISHABLE_KEY).
 */

export function getEnvVar(key: string): string {
  return Deno.env.get(key) || '';
}

export function getSupabaseUrl(): string {
  return getEnvVar('SUPABASE_URL') || getEnvVar('PROJECT_URL') || '';
}

export function getSecretKey(): string {
  return getEnvVar('TUGGI_SECRET_KEY') || 
         getEnvVar('API_SECRET_KEY') ||
         '';
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

/**
 * Validador para tokens Authorization internos da EFs.
 * @param token - Bearer token extraído da header
 * @returns true caso seja uma das Secret Keys (legada ou nova)
 */
export function isValidSecretKey(token: string): boolean {
  return [
    getEnvVar('TUGGI_SECRET_KEY'),
    getEnvVar('API_SECRET_KEY')
  ].some(key => Boolean(key) && key === token);
}
