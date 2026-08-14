/**
 * What the two internal screens read from `/api/admin/partner-*`.
 *
 * Declared once and shared by the list, the review page and the promotion panel, so a field
 * the route stops returning breaks the type instead of rendering `undefined` in a table.
 *
 * Note what is NOT here: no token, in any shape, and no `storage_path`. The routes do not
 * return them and this type is the second place that says so.
 */

import type { useTranslations } from 'next-intl'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import type { PartnerDocumentKind } from '@/lib/partner-form/fields'
import type {
  InviteSituation,
  ProposalStatus,
} from '@/lib/services/partner-proposal-admin-service'

export type { InviteSituation, ProposalStatus }

export interface InviteRow {
  id: string
  submissionId: string
  clientId: string | null
  recipientEmail: string
  recipientName: string | null
  tradeName: string | null
  situation: InviteSituation
  isPartial: boolean
  submissionStatus: ProposalStatus | null
  revocable: boolean
  expiresAt: string
  createdAt: string
}

export interface ProposalRow {
  id: string
  status: ProposalStatus
  isPartial: boolean
  tradeName: string | null
  taxId: string | null
  city: string | null
  state: string | null
  recipientEmail: string | null
  documentCount: number
  submittedAt: string | null
  updatedAt: string | null
  promotedAt: string | null
  promotedClientId: string | null
  missingForContract: string[]
}

export interface ProposalDocument {
  id: string
  kind: PartnerDocumentKind
  fileName: string
  byteSize: number
  mimeType: string
  createdAt: string
}

export interface ProposalInvite {
  id: string
  recipientEmail: string
  recipientName: string | null
  tradeName: string | null
  expiresAt: string
  usedAt: string | null
  revokedAt: string | null
  createdAt: string
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
    isPartial: boolean
    submittedAt: string | null
    updatedAt: string | null
    createdAt: string
    promotedAt: string | null
    promotedBy: string | null
    promotedClientId: string | null
  }
  invites: ProposalInvite[]
  documents: ProposalDocument[]
  client: ProposalClient | null
  /**
   * Another client already holds the representative's e-mail; `core.clients.email` is unique.
   * The whole record, because "tie the proposal to that client" is one of the two ways out and
   * the panel has to compare against it.
   */
  emailConflict: { client: ProposalClient } | null
}

/** The one shape the invite drawer shows exactly once (DS-COMPONENTE-019). */
export interface CreatedInviteResult {
  inviteId: string
  submissionId: string
  recipientEmail: string
  expiresAt: string
  url: string
  emailed: boolean
}

/**
 * The `t` of these screens, so a helper outside a component can format a line without the
 * caller widening it to `any`. Derived from `useTranslations`, never re-declared by hand.
 */
export type Translator = ReturnType<typeof useTranslations>
