'use client'

/**
 * QUANTO SAIU — o passo entre apertar `Despachar` e o pedido andar.
 *
 * POR QUE ELE EXISTE, EM UMA FRASE DO OPERADOR: *"não é pq um parceiro pediu 40 displays, que
 * enviamos os 40"* (2026-09-01). Até esse dia o custo era calculado sobre a quantidade PEDIDA, e
 * superestimava todo parceiro que recebeu menos — na direção que faz uma parceria parecer cara.
 *
 * AQUI É O ÚNICO MOMENTO EM QUE ALGUÉM SABE A RESPOSTA. Quem move o card para `Despachado` está
 * com a caixa fechada na frente; perguntar depois, numa lista de pendências, é perguntar a
 * alguém que vai ter de lembrar. A lista de pendências existe assim mesmo, no Financeiro, para o
 * que passou batido — mas ela é o conserto, não o caminho.
 *
 * O CAMPO VEM PREENCHIDO COM O QUE FOI PEDIDO, e ao lado dele fica escrito quanto foi pedido.
 * Preencher não é supor: o operador confirma ou corrige, e o número que sai daqui é um ato dele.
 * Deixar em branco custaria uma digitação em todo despacho, e o caminho de menor esforço passaria
 * a ser fechar o diálogo sem responder.
 *
 * SEM CANCELAR SILENCIOSO: fechar o diálogo NÃO move o pedido. Mover sem informar deixaria o
 * pedido custeado por ninguém, que é a situação que este diálogo existe para acabar.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { DialogShell } from '@/components/admin/credit/DialogShell'
import { Button } from '@/components/ui/button'
import type { MaterialQueueOrder } from '@/lib/materials/order-queue'
import type { MaterialMoveStatus } from '@/lib/materials/order-queue'

export interface ShipmentLine {
  productId: string
  productName: string
  requestedQuantity: number
  quantity: string
}

interface Props {
  order: MaterialQueueOrder | null
  status: MaterialMoveStatus | null
  /** `kind` da esteira → produto do financeiro. Vazio quando o catálogo não respondeu. */
  productByKind: Record<string, { id: string; name: string }>
  busy: boolean
  onCancel: () => void
  onConfirm: (lines: { productId: string; quantity: number; requestedQuantity: number }[]) => void
}

export function ShipmentDialog({ order, status, productByKind, busy, onCancel, onConfirm }: Props) {
  const t = useTranslations('Materials.shipment')
  const firstFieldRef = useRef<HTMLInputElement>(null)

  const initial = useMemo<ShipmentLine[]>(() => {
    if (!order) return []
    return order.items.flatMap((item) => {
      const product = productByKind[item.kind]
      if (!product) return []
      return [
        {
          productId: product.id,
          productName: product.name,
          requestedQuantity: item.quantity,
          quantity: String(item.quantity),
        },
      ]
    })
  }, [order, productByKind])

  const [lines, setLines] = useState<ShipmentLine[]>(initial)
  useEffect(() => setLines(initial), [initial])

  const invalid = lines.some((line) => {
    const value = Number(line.quantity)
    return !Number.isInteger(value) || value < 0 || value > 9999
  })

  const open = order !== null && status !== null && lines.length > 0

  return (
    <DialogShell
      open={open}
      title={t('title')}
      busy={busy}
      onClose={onCancel}
      initialFocusRef={firstFieldRef}
      footer={
        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button
            variant="cta"
            disabled={busy || invalid}
            onClick={() =>
              onConfirm(
                lines.map((line) => ({
                  productId: line.productId,
                  quantity: Number(line.quantity),
                  requestedQuantity: line.requestedQuantity,
                }))
              )
            }
          >
            {busy ? t('saving') : t('confirm')}
          </Button>
        </div>
      }
    >
      <p className="mb-4 text-sm text-gray-700 dark:text-gray-300">
        {t('intro', { client: order?.clientName ?? '' })}
      </p>

      <ul className="space-y-3">
        {lines.map((line, index) => (
          <li key={line.productId} className="flex items-center gap-3">
            <label
              htmlFor={`shipped-${line.productId}`}
              className="flex-1 text-sm text-gray-900 dark:text-gray-100"
            >
              {line.productName}
              {/* O pedido fica visível ao lado do campo: é o que torna uma divergência legível
                  sem o operador ter de lembrar o que o parceiro havia pedido. */}
              <span className="ml-2 text-[11px] text-gray-600 dark:text-gray-400">
                {t('requested', { count: line.requestedQuantity })}
              </span>
            </label>
            <input
              id={`shipped-${line.productId}`}
              ref={index === 0 ? firstFieldRef : undefined}
              type="number"
              min={0}
              max={9999}
              inputMode="numeric"
              value={line.quantity}
              onChange={(event) =>
                setLines((current) =>
                  current.map((entry, position) =>
                    position === index ? { ...entry, quantity: event.target.value } : entry
                  )
                )
              }
              className="min-h-[32px] w-24 rounded-lg border border-gray-300 bg-white px-2 py-1 text-right text-sm tabular-nums text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          </li>
        ))}
      </ul>

      <p className="mt-4 text-[11px] text-gray-600 dark:text-gray-400">{t('zeroHint')}</p>
    </DialogShell>
  )
}
