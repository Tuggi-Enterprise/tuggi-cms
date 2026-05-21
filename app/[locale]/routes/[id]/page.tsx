'use client'

/**
 * /routes/[id] — redirect para /routes?editId=[id]
 *
 * A edição de rotas agora ocorre no modal de /routes.
 * Esta página serve como entrada de deep link para compatibilidade.
 */

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useRouter } from '@/navigation'

export default function EditRoutePage() {
  const { id }  = useParams()
  const router  = useRouter()

  useEffect(() => {
    if (id) router.replace(`/routes?editId=${id}`)
  }, [id, router])

  return (
    <div className="h-full flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-tuggi-blue/20 border-t-tuggi-blue rounded-full animate-spin" />
    </div>
  )
}
