/**
 * #1144 — what the routes of the moderation of public names answer, already in the shape the
 * screens read. Invented accounts and values.
 */

import type { AccountIdentity, FilterLists, IdentityReportRow } from '@/lib/public-identity/moderation'

export const ALICE = '11111111-1111-4111-8111-111111111111'

export const REPORTS: IdentityReportRow[] = [
  {
    reportId: 7,
    userId: ALICE,
    nickname: 'rei.do.palavrao',
    field: 'nickname',
    reportedValue: 'rei.do.palavrao',
    surface: 'scoreboard',
    reportsCount: 3,
    firstReportedAt: '2026-11-08T10:00:00Z',
    lastReportedAt: '2026-11-08T12:00:00Z',
  },
  {
    reportId: 8,
    userId: '22222222-2222-4222-8222-222222222222',
    nickname: 'Andarilho42',
    field: 'display_name',
    reportedValue: 'Nome Ofensivo',
    surface: 'discovered_by',
    reportsCount: 1,
    firstReportedAt: '2026-11-09T08:00:00Z',
    lastReportedAt: '2026-11-09T08:00:00Z',
  },
  {
    reportId: 9,
    userId: '33333333-3333-4333-8333-333333333333',
    nickname: 'mar.azul',
    field: 'bio',
    reportedValue: 'Bio com ataque a outra pessoa,\nem duas linhas.',
    surface: 'profile_page',
    reportsCount: 2,
    firstReportedAt: '2026-11-09T09:00:00Z',
    lastReportedAt: '2026-11-09T11:00:00Z',
  },
]

const COMMIT = '5faf2ba42d7b1c0977169ec3611df25a3c08eb13'

export const LISTS: FilterLists = {
  reserved: ['admin', 'api', 'app', 'equipe', 'help', 'moderador', 'oficial', 'suporte', 'studio', 'tuggi'].map((name) => ({
    name,
    nameKey: name,
    match: name === 'tuggi' ? ('contains' as const) : ('exact' as const),
    appliesToDisplayName: name === 'tuggi',
  })),
  own: [
    { id: 1, kind: 'blocked', term: 'Fuckboy', normalized: 'fuckboy' },
    { id: 2, kind: 'allowed', term: 'Cazzola', normalized: 'cazzola' },
    { id: 3, kind: 'allowed', term: 'Ana Lucia', normalized: 'analucia' },
  ],
  ldnoobw: {
    languages: [
      { language: 'en', terms: ['termo-en-1', 'termo-en-2', 'termo-en-3'] },
      { language: 'es', terms: ['termo-es-1', 'termo-es-2'] },
      { language: 'fr', terms: ['termo-fr-1'] },
      { language: 'it', terms: ['termo-it-1'] },
      { language: 'pt', terms: ['termo-pt-1', 'termo-pt-2'] },
    ],
    commits: [COMMIT],
    total: 9,
  },
}

export const IDENTITY: AccountIdentity = {
  displayName: 'Rei do Palavrão',
  nickname: 'rei.do.palavrao',
  bio: 'Viajo pelo litoral.',
  resetAt: { display_name: null, nickname: null, bio: '2026-11-08T12:00:00Z' },
  locked: false,
  lockedAt: null,
}
