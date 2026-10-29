/**
 * The frame the social agenda screens (#1058) need to mount outside Next: the pt namespaces they
 * read (named on purpose, a missing one would print key paths) and a stand-in App Router, because
 * both screens read `useSearchParams`, `useParams` and `useRouter`. Components only: the CT runner
 * refuses to mount from a module that also exports data (fixtures live in `social-fixtures.ts`).
 */

import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import {
  PathParamsContext,
  PathnameContext,
  SearchParamsContext,
} from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import ptMessages from '@/messages/pt.json'
import { SocialAgendaPageContent } from '@/components/admin/social/SocialAgendaPageContent'
import { SocialPostEditorPageContent } from '@/components/admin/social/SocialPostEditorPageContent'

const noop = () => undefined
const router = { push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: noop, hmrRefresh: noop }

function Frame({ path, search, children }: { path: string; search: string; children: ReactNode }) {
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <AppRouterContext.Provider value={router as any}>
      <PathnameContext.Provider value={path}>
        <SearchParamsContext.Provider value={new URLSearchParams(search) as never}>
          <PathParamsContext.Provider value={{ locale: 'pt' }}>
            <NextIntlClientProvider
              locale="pt"
              timeZone="America/Sao_Paulo"
              messages={{
                Pages: { Social: ptMessages.Pages.Social },
                Common: { actions: ptMessages.Common.actions, status: ptMessages.Common.status },
              }}
            >
              {children}
            </NextIntlClientProvider>
          </PathParamsContext.Provider>
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  )
}

export function SocialAgendaHarness({ search }: { search: string }) {
  return (
    <Frame path="/pt/admin/social" search={search}>
      <SocialAgendaPageContent />
    </Frame>
  )
}

export function SocialEditorHarness({ postId, search }: { postId: string | null; search: string }) {
  return (
    <Frame path={postId ? `/pt/admin/social/${postId}` : '/pt/admin/social/new'} search={search}>
      <SocialPostEditorPageContent postId={postId} />
    </Frame>
  )
}
