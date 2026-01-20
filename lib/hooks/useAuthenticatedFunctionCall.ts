/**
 * Hook para fazer chamadas autenticadas às Edge Functions
 * Automaticamente adiciona o Authorization Bearer token
 */

'use client'

import { useCallback } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

export function useAuthenticatedFunctionCall() {
  const supabase = createClientComponentClient()

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
          return {
            error: new Error(
              error.message || `Erro ao chamar ${functionName}`
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
