/**
 * What the internal screen reads from `/api/admin/partner-proposals`.
 *
 * Declared once and shared by the list, the review page and the promotion panel, so a field
 * the route stops returning breaks the type instead of rendering `undefined` in a table.
 */

import type { useTranslations } from 'next-intl'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import type { ConferenceRecord } from '@/lib/partner-form/regularity'
import type { ReviewNote } from '@/lib/partner-form/proposal-review'
import type { ProposalStatus } from '@/lib/services/partner-proposal-admin-service'

export type { ProposalStatus }

export interface ProposalRow {
  id: string
  status: ProposalStatus
  tradeName: string | null
  taxId: string | null
  city: string | null
  state: string | null
  /** Who filled the form in — read from the answers; there is no invite behind it. */
  contactEmail: string | null
  /** How many other proposals are waiting with the same CNPJ. */
  duplicateCount: number
  submittedAt: string | null
  updatedAt: string | null
  promotedAt: string | null
  promotedClientId: string | null
  missingForContract: string[]
}

export interface ProposalClient {
  id: string
  name: string | null
  email: string | null
  [column: string]: unknown
}

export interface ProposalDetail {
  submission: {
    id: string
    status: ProposalStatus
    answers: PartnerAnswers
    submittedAt: string | null
    updatedAt: string | null
    createdAt: string
    promotedAt: string | null
    /** Who, in words — the route resolves the auth uid before it gets here. */
    promotedBy: string | null
    promotedClientId: string | null
    /** When the conference was last registered, and by whom (BR-B2B-030, item 2). */
    reviewedAt: string | null
    reviewedBy: string | null
  }
  /** The annotation already stored, so the screen opens on what the last reviewer wrote. */
  note: ReviewNote
  /** What the team registered having seen in person — the input of the regularity band. */
  conference: ConferenceRecord
  client: ProposalClient | null
  /** Other proposals still waiting with this CNPJ. Never merged; a person decides. */
  duplicates: { id: string; submittedAt: string | null }[]
}

/**
 * The `t` of these screens, so a helper outside a component can format a line without the
 * caller widening it to `any`. Derived from `useTranslations`, never re-declared by hand.
 */
export type Translator = ReturnType<typeof useTranslations>
