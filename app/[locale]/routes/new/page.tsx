'use client'

/**
 * /routes/new — redirect para /routes?mode=new
 *
 * A criação de rotas agora ocorre no modal de /routes.
 * Esta página serve como entrada de deep link para compatibilidade.
 */

import { useEffect } from 'react'
import { useRouter } from '@/navigation'

export default function NewRoutePage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/routes?mode=new')
  }, [router])

  return (
    <div className="h-full flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-tuggi-blue/20 border-t-tuggi-blue rounded-full animate-spin" />
    </div>
  )
}
