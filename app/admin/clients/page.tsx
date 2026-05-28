import { redirect } from 'next/navigation'

/**
 * Server-side redirect to the locale-prefixed route. Lives at the
 * non-locale path so the build doesn't try to prerender a tree that
 * uses useTranslations() without a request-time next-intl provider —
 * the real content is in components/admin/AdminClientsPageContent and
 * is rendered by app/[locale]/admin/clients/page.tsx.
 *
 * Runtime middleware also redirects /admin/clients → /<locale>/admin/
 * clients, so this is belt-and-braces for direct hits + build-time
 * skip of prerender.
 */
export default function NonLocaleClientsRedirect() {
  redirect('/en/admin/clients')
}
