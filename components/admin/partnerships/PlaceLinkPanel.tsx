'use client'

/**
 * `Este lugar já está no catálogo?` — the panel that stops the duplicates. #409.
 *
 * IT COMES BEFORE THE CREATE BUTTON, AND THAT ORDER IS THE FIX. Until now band 4 offered
 * `Criar o local a partir da proposta` and a link to `/places` with no writer behind it
 * (`PartnershipDetail` said so in a comment: "the writer is card #374"). Every one of the three
 * clients who used the create path ended up with two rows for one address — the establishment
 * already published, and an empty one the pipeline then reported pendencies about. Searching
 * first is the ordinary case; creating is what is left when the catalogue really does not
 * carry the place.
 *
 * A REFUSED CANDIDATE IS STILL SHOWN, with its reason. The alternative — filtering it out —
 * answers `Tucas` with an empty list while `Tucas Empório Bistrô` sits in the catalogue, and
 * the operator creates the duplicate all over again. `este é um evento`, `sem ponto no mapa`
 * and `já é o local de outro cliente` are three different next steps, and each one is an answer.
 *
 * The verdict rendered here is `verdictFor`, the same pure rule the route applies — but the
 * GATE is the route: this list is minutes old by the time somebody clicks.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MIN_SEARCH_LENGTH, isSearchable, type LinkCandidate, type LinkVerdict } from '@/lib/partnerships/place-link'
import { DEFAULT_SCOPE, type ScopeMode } from '@/lib/partnerships/place-scope'

type Candidate = LinkCandidate & { verdict: LinkVerdict }

interface PlaceLinkPanelProps {
  clientId: string
  locale: string
  /** Re-read the places after a link lands. The panel never paints the result itself. */
  onLinked: () => void | Promise<void>
}

/** Long enough that typing a name does not fire a request per keystroke. */
const DEBOUNCE_MS = 350

export function PlaceLinkPanel({ clientId, locale, onLinked }: PlaceLinkPanelProps) {
  const t = useTranslations('Partnerships.placeLink')

  const [term, setTerm] = useState('')
  const [mode, setMode] = useState<ScopeMode>(DEFAULT_SCOPE)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [scopeCity, setScopeCity] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [failed, setFailed] = useState(false)
  // The client's registration has no city, so there is no indexable query — see the route.
  const [scopeMissing, setScopeMissing] = useState(false)
  const [linking, setLinking] = useState<string | null>(null)
  const [linkFailed, setLinkFailed] = useState(false)

  useEffect(() => {
    if (!isSearchable(term)) {
      setCandidates([])
      setFailed(false)
      setScopeMissing(false)
      return
    }

    let active = true
    setSearching(true)
    setFailed(false)
    setScopeMissing(false)

    const timer = setTimeout(() => {
      void fetch(
        `/api/admin/partnerships/clients/${clientId}/places/candidates` +
          `?q=${encodeURIComponent(term.trim())}&scope=${mode}`
      )
        .then(async (response) => {
          if (!active) return
          if (!response.ok) {
            setFailed(true)
            setCandidates([])
            return
          }
          const payload = (await response.json()) as {
            candidates: Candidate[]
            scope: string | null
            error?: string
          }
          setCandidates(payload.candidates)
          setScopeCity(payload.scope)
          // A refusal that is not a failure: the search CANNOT run without the client's city,
          // and saying `nenhum lugar com esse nome` over a search that never happened is what
          // sends the operator to the create button.
          setScopeMissing(payload.error === 'scope_required')
        })
        .catch(() => {
          if (active) setFailed(true)
        })
        .finally(() => {
          if (active) setSearching(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [term, clientId, mode])

  const link = useCallback(
    async (attractionId: string) => {
      setLinking(attractionId)
      setLinkFailed(false)
      try {
        const response = await fetch(`/api/admin/partnerships/clients/${clientId}/places/link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attractionId }),
        })
        if (!response.ok) {
          setLinkFailed(true)
          setLinking(null)
          return
        }
      } catch {
        setLinkFailed(true)
        setLinking(null)
        return
      }
      // The place appearing in the list above is the answer; a banner over an unchanged list
      // would be worse than no banner.
      setTerm('')
      setCandidates([])
      setLinking(null)
      await onLinked()
    },
    [clientId, onLinked]
  )

  const short = term.trim().length > 0 && !isSearchable(term)

  return (
    <section aria-labelledby="place-link-heading" className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
      <h3 id="place-link-heading" className="text-sm font-semibold text-gray-900 dark:text-white">
        {t('title')}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-gray-700 dark:text-gray-300">{t('body')}</p>

      <label htmlFor="place-link-search" className="sr-only">
        {t('searchLabel')}
      </label>
      <div className="group relative mt-3">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <Search className="h-4 w-4 text-gray-400" aria-hidden="true" />
        </div>
        <input
          id="place-link-search"
          type="text"
          value={term}
          placeholder={t('searchPlaceholder')}
          onChange={(event) => setTerm(event.target.value)}
          className="w-full rounded-xl border border-gray-200 bg-gray-50/50 py-2 pl-10 pr-4 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-primary-800 dark:border-gray-700 dark:bg-gray-800/50 dark:text-white"
        />
      </div>

      <div role="status" className="mt-2 text-xs text-gray-700 dark:text-gray-300">
        {short && t('minLength', { count: MIN_SEARCH_LENGTH })}
        {searching && t('searching')}
        {failed && t('failed')}
        {scopeMissing && t('scopeMissing')}
        {/* O RECORTE É DITO E O QUE ELE ESCONDEU TAMBÉM. `Nenhum em Cabo Frio` sobre um bar que
            existe em Cabo Frio é o mesmo erro de não ter busca; `Nenhum em Cabo Frio · mais 3 em
            outras cidades` é uma frase sobre a qual dá para decidir. */}
        {!searching && !failed && !scopeMissing && isSearchable(term) && candidates.length === 0 && (
          scopeCity && mode === 'city' ? t('emptyInCity', { city: scopeCity }) : t('empty')
        )}
      </div>

      {isSearchable(term) && !searching && !failed && scopeCity && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
          <span>{mode === 'city' ? t('scopeCity', { city: scopeCity }) : t('scopeAll')}</span>
          <button
            type="button"
            onClick={() => setMode(mode === 'city' ? 'all' : 'city')}
            className="min-h-[24px] font-medium text-primary-800 underline underline-offset-4 dark:text-tuggi-blue"
          >
            {mode === 'city' ? t('widen') : t('narrow', { city: scopeCity })}
          </button>
        </div>
      )}

      {linkFailed && (
        <p role="alert" className="mt-2 text-xs text-gray-900 dark:text-white">
          {t('linkFailed')}
        </p>
      )}

      {candidates.length > 0 && (
        <ul className="mt-3 space-y-2">
          {candidates.map((candidate) => (
            <li
              key={candidate.attractionId}
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-gray-200 p-3 dark:border-gray-800"
            >
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-gray-900 dark:text-white">
                  {candidate.name}
                </p>
                <p className="text-xs text-gray-700 dark:text-gray-400">
                  {[candidate.entityKind, candidate.city, candidate.state, candidate.country]
                    .filter(Boolean)
                    .join(' · ')}
                  {' · '}
                  {candidate.approved ? t('approved') : t('notApproved')}
                </p>

                {/* Why it cannot be linked, and what to do about it — never a disabled control
                    with no explanation beside it (DS-COMPONENTE-020, 1st edge case). */}
                {candidate.verdict.kind === 'refused' && (
                  <p className="mt-1 text-xs text-gray-900 dark:text-gray-200">
                    {t(`refused.${candidate.verdict.reason}`)}
                  </p>
                )}
                {candidate.verdict.kind === 'already_linked' && (
                  <p className="mt-1 text-xs text-gray-900 dark:text-gray-200">{t('alreadyLinked')}</p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <Link
                  href={`/${locale}/pois/${candidate.attractionId}`}
                  className="min-h-[24px] text-xs font-medium text-primary-800 underline underline-offset-4 dark:text-tuggi-blue"
                >
                  {t('openEditor')}
                </Link>
                {candidate.verdict.kind === 'ok' && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={linking !== null}
                    onClick={() => void link(candidate.attractionId)}
                  >
                    {linking === candidate.attractionId ? t('linking') : t('linkAction')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
