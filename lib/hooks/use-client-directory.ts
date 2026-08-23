'use client'

/**
 * The one read behind both views of `/admin/clients`.
 *
 * IT IS A HOOK AND NOT A FETCH INSIDE THE TABLE because the board arrived (#409) and the two
 * are the same list. With the request living in `ClientDirectory`, switching Quadro/Tabela
 * re-fetched a thousand rows to render the same data, and an act performed on a card had no way
 * to invalidate the table behind it. One request, one set of rows, one `reload` both call.
 *
 * The guarantee `tests/api/client-directory-surface.test.ts` holds is unchanged and now lives
 * here: ONE endpoint, called once. Nothing filters at this level — `buildDirectoryView` decides
 * what is shown, so the facet counts and the rows always come from the same set.
 */

import { useCallback, useEffect, useState } from 'react'
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'

const DIRECTORY_ENDPOINT = '/api/admin/clients/directory'

export interface ClientDirectoryState {
  rows: ClientDirectoryRow[]
  /** True when the server's caps cut the set. The screen says so rather than lying by omission. */
  truncated: boolean
  loading: boolean
  failed: boolean
  /** Re-reads the list. What an act on a card calls once the write came back. */
  reload: () => void
}

export function useClientDirectory(): ClientDirectoryState {
  const [rows, setRows] = useState<ClientDirectoryRow[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [token, setToken] = useState(0)

  const reload = useCallback(() => {
    // Cleared here and not in the effect: a reload keeps the rows on screen, because blanking
    // the board to re-read it would make every act look like it emptied the list.
    setFailed(false)
    setToken((value) => value + 1)
  }, [])

  useEffect(() => {
    let active = true

    void fetch(DIRECTORY_ENDPOINT)
      .then(async (response) => {
        if (!active) return
        if (!response.ok) {
          setFailed(true)
          setLoading(false)
          return
        }
        const payload = (await response.json()) as {
          rows: ClientDirectoryRow[]
          truncated: boolean
        }
        setRows(payload.rows)
        setTruncated(payload.truncated)
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        setFailed(true)
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [token])

  return { rows, truncated, loading, failed, reload }
}
