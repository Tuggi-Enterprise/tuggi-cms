'use client'

/**
 * Layout do Módulo Financeiro: gate por entitlement (espelha Locais e Eventos) + Header.
 * Defesa em profundidade junto do `proxy.ts`, que já barra quem não tem `finance` em
 * `enabled_modules` — admin passa por ser onipotente por código, em `lib/modules/index.ts`.
 *
 * Manda para `/dashboard` e não para `/unauthorized` pelo mesmo motivo dos outros dois: quem
 * chega aqui sem o módulo não teve permissão negada, está no lugar errado.
 */

import { useEffect } from 'react'
import { useRouter } from '@/navigation'
import { Header } from '@/components/ui/Header'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { MODULES } from '@/lib/modules'

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { hasModule, isLoading } = useCmsUser()
  const allowed = hasModule(MODULES.FINANCE)

  useEffect(() => {
    if (!isLoading && !allowed) router.replace('/dashboard')
  }, [isLoading, allowed, router])

  if (!isLoading && !allowed) return null

  return (
    <>
      <Header />
      <main className="min-h-screen bg-gray-50/50 dark:bg-gray-950">{children}</main>
    </>
  )
}
