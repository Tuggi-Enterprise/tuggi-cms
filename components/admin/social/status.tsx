'use client'

/**
 * Network monogram and status glyph of the social agenda (#1058, spec 4.1 and 4.2). Every status has
 * glyph, word and ink, never the colour alone (DS-A11Y-003); enum values never reach the screen
 * raw (DS-COPY-021).
 */

import { Ban, CircleAlert, CircleCheck, Clock, LoaderCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { Network, TargetStatus } from '@/lib/social/post'
import { DIM } from '@/components/ui/dense-table'

const GLYPH: Record<TargetStatus, { Icon: typeof Clock; ink: string; spin?: boolean }> = {
  scheduled: { Icon: Clock, ink: 'text-gray-700 dark:text-gray-300' },
  publishing: { Icon: LoaderCircle, ink: 'text-primary-800 dark:text-tuggi-blue', spin: true },
  published: { Icon: CircleCheck, ink: 'text-green-700 dark:text-green-400' },
  failed: { Icon: CircleAlert, ink: 'text-red-700 dark:text-red-400' },
  canceled: { Icon: Ban, ink: DIM },
}

const MONOGRAM: Record<Network, string> = { instagram: 'IG', facebook: 'FB' }

export function useNetworkName() {
  const t = useTranslations('Pages.Social.form')
  return (network: Network) => t(network === 'instagram' ? 'network_instagram' : 'network_facebook')
}

export function Monogram({ network }: { network: Network }) {
  const name = useNetworkName()
  return (
    <span
      aria-label={name(network)}
      role="img"
      className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-gray-300 px-1 text-[10px] font-bold tracking-wide text-gray-700 dark:border-gray-600 dark:text-gray-300"
    >
      {MONOGRAM[network]}
    </span>
  )
}

/** Glyph alone (chips and list, with an accessible name) or glyph and word (editor panel). */
export function StatusGlyph({ status, withWord, label }: { status: TargetStatus; withWord?: boolean; label?: string }) {
  const t = useTranslations('Pages.Social.status')
  const { Icon, ink, spin } = GLYPH[status]
  const word = t(status)
  return (
    <span className={`inline-flex items-center gap-1 ${ink}`}>
      <Icon
        aria-hidden={withWord ? true : undefined}
        aria-label={withWord ? undefined : label ?? word}
        role={withWord ? undefined : 'img'}
        className={`h-3.5 w-3.5 shrink-0 ${spin ? 'animate-spin motion-reduce:animate-none' : ''}`}
      />
      {withWord ? <span className="text-sm font-medium">{word}</span> : null}
    </span>
  )
}
