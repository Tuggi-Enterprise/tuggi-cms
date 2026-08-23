import { redirect } from 'next/navigation'

/**
 * Server-side redirect to the locale-prefixed route, the same shape `/admin/clients` uses: the
 * real content is a client tree that calls `useTranslations()`, and prerendering it here without
 * a request-time next-intl provider crashes the build.
 */
export default function NonLocaleMaterialsRedirect() {
  redirect('/en/admin/materials')
}
