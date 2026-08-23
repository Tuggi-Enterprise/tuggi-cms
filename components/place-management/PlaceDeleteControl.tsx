'use client'

/**
 * `Excluir este local` — com a confirmação e, quando é o caso, com a recusa explicada.
 *
 * A CONFIRMAÇÃO É EM DOIS PASSOS E FICA NA TELA, não num `window.confirm`. O diálogo nativo é
 * uma linha de texto que o operador dispensa no reflexo, e para um ato que apaga em cascata 17
 * tabelas isso é pouco. Aqui o segundo clique fica ao lado do nome do que vai sumir.
 *
 * A RECUSA VEM COM TODOS OS MOTIVOS, e cada um é uma coisa diferente a fazer: desvincular o
 * parceiro, trocar o POI de boas-vindas, ou aceitar que aquele registro tem história e sair do
 * ar por `is_active` em vez de sumir. Devolver um motivo por vez faria o operador tentar de novo
 * para descobrir o seguinte.
 *
 * O QUE DECIDE É O SERVIDOR — `lib/core/place-delete`, aplicado na rota sobre contagens lidas no
 * instante do clique. Este componente não adivinha se dá para apagar: ele pede, e conta o que
 * ouviu.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DeleteBlocker } from '@/lib/core/place-delete'

interface PlaceDeleteControlProps {
  attractionId: string
  name: string
  /** Fecha a gaveta e recarrega a lista — o local não existe mais para voltar a ela. */
  onDeleted: () => void | Promise<void>
}

export function PlaceDeleteControl({ attractionId, name, onDeleted }: PlaceDeleteControlProps) {
  const t = useTranslations('Modals.PlaceDetails.delete')

  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [blockers, setBlockers] = useState<DeleteBlocker[] | null>(null)
  const [failed, setFailed] = useState(false)

  async function remove() {
    setDeleting(true)
    setFailed(false)
    setBlockers(null)
    try {
      const response = await fetch(`/api/admin/places/${attractionId}`, { method: 'DELETE' })
      if (response.ok) {
        setConfirming(false)
        setDeleting(false)
        await onDeleted()
        return
      }
      const payload = (await response.json().catch(() => null)) as {
        error?: string
        reasons?: DeleteBlocker[]
      } | null
      if (payload?.error === 'has_history' && payload.reasons) setBlockers(payload.reasons)
      else setFailed(true)
    } catch {
      setFailed(true)
    }
    setConfirming(false)
    setDeleting(false)
  }

  return (
    <section aria-labelledby="place-delete-heading" className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-800">
      <h3 id="place-delete-heading" className="sr-only">
        {t('action')}
      </h3>

      {blockers && (
        <div className="mb-3 rounded-xl border border-secondary-700 p-3 text-xs text-gray-900 dark:text-gray-200">
          <p className="font-medium">{t('blockedTitle')}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {blockers.map((reason) => (
              <li key={reason}>{t(`reasons.${reason}`)}</li>
            ))}
          </ul>
          <p className="mt-2 text-gray-800 dark:text-gray-300">{t('blockedHint')}</p>
        </div>
      )}

      {failed && (
        <p role="alert" className="mb-2 text-xs text-gray-900 dark:text-white">
          {t('failed')}
        </p>
      )}

      {confirming ? (
        <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
          <p className="text-xs text-gray-900 dark:text-gray-200">{t('confirm', { name })}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" disabled={deleting} onClick={() => setConfirming(false)}>
              {t('cancel')}
            </Button>
            <Button type="button" variant="destructive" disabled={deleting} onClick={() => void remove()}>
              {deleting ? t('deleting') : t('confirmAction')}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex min-h-[24px] items-center gap-1.5 text-xs font-medium text-destructive underline underline-offset-4"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          {t('action')}
        </button>
      )}
    </section>
  )
}
