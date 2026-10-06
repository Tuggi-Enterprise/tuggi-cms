'use client'

/**
 * One read per client record, shared by its tabs (#875, item 1).
 *
 * The tabs of `ClientEditorModal` mount only while active, and two pairs of them read the same
 * endpoint: `PartnershipDetail` and `PlacesTab` read the partnership detail, `ContractTab` and
 * `FiscalPaymentsTab` read the contract. Every switch was a fresh round trip. The modal owns one
 * cache per open record; a tab asks `read(url)` and gets the answer already in flight or done.
 *
 * `fresh` is for the reads that follow an act — the answer replaces the cached one, so the
 * neighbouring tab sees the state the act produced. Only `ok` answers are kept: a failure is
 * retried by the next read, not remembered.
 *
 * Outside a provider (no record around it) `read` is a plain fetch.
 */

import { createContext, useCallback, useContext, type ReactNode } from 'react'

export interface RecordRead<T = unknown> {
  ok: boolean
  status: number
  body: T | null
}

type Cache = Map<string, Promise<RecordRead>>

const RecordCacheContext = createContext<Cache | null>(null)

export function RecordCacheProvider({ cache, children }: { cache: Cache; children: ReactNode }) {
  return <RecordCacheContext.Provider value={cache}>{children}</RecordCacheContext.Provider>
}

async function readJson(url: string): Promise<RecordRead> {
  const response = await fetch(url)
  const body = await response.json().catch(() => null)
  return { ok: response.ok, status: response.status, body }
}

export function useRecordRead() {
  const cache = useContext(RecordCacheContext)

  return useCallback(
    <T,>(url: string, options: { fresh?: boolean } = {}): Promise<RecordRead<T>> => {
      if (!cache) return readJson(url) as Promise<RecordRead<T>>
      const cached = options.fresh ? undefined : cache.get(url)
      if (cached) return cached as Promise<RecordRead<T>>

      const pending = readJson(url).then(
        (read) => {
          if (!read.ok && cache.get(url) === pending) cache.delete(url)
          return read
        },
        (error: unknown) => {
          if (cache.get(url) === pending) cache.delete(url)
          throw error
        }
      )
      cache.set(url, pending)
      return pending as Promise<RecordRead<T>>
    },
    [cache]
  )
}
