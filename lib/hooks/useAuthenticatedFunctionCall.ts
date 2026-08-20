/**
 * Hook para fazer chamadas autenticadas às Edge Functions
 * Automaticamente adiciona o Authorization Bearer token
 */

'use client'

import { useCallback } from 'react'
import { getSupabaseClient } from '@/lib/core/supabase-client'
import { readEdgeFunctionError } from '@/lib/core/edge-function-error'

export function useAuthenticatedFunctionCall() {
  const supabase = getSupabaseClient()

  const callFunction = useCallback(
    async <T = any,>(
      functionName: string,
      body: Record<string, any> = {},
      options?: {
        headers?: Record<string, string>
      }
    ): Promise<{ data?: T; error?: Error }> => {
      try {
        // 1. Obter sessão e token
        const {
          data: { session },
          error: sessionError
        } = await supabase.auth.getSession()

        if (sessionError || !session) {
          return {
            error: new Error('Não autenticado. Faça login para continuar.')
          }
        }

        const token = session.access_token

        // 2. Chamar edge function com Authorization header
        const { data, error } = await supabase.functions.invoke(functionName, {
          body,
          headers: {
            'Authorization': `Bearer ${token}`,
            ...options?.headers
          }
        })

        if (error) {
          // The body first: supabase-js reports every non-2xx as "Edge Function returned a
          // non-2xx status code", which tells the operator nothing. The function's own message
          // ("No description found for attraction …") is in the response it kept on the error.
          const detail = await readEdgeFunctionError(error)
          return {
            error: new Error(
              detail || error.message || `Erro ao chamar ${functionName}`
            )
          }
        }

        return { data }
      } catch (err) {
        return {
          error: err instanceof Error ? err : new Error('Erro desconhecido')
        }
      }
    },
    [supabase]
  )

  return { callFunction }
}
