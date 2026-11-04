import { redirect } from 'next/navigation'

import { conversionRedirectTarget } from '@/lib/engagement/months'

/**
 * The Conversion report moved into the Engagement and conversion page (#1101, spec §C8.3): this route
 * only redirects, 307 because the decision is internal and reversible.
 */
export default async function ConversionRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams])
  redirect(conversionRedirectTarget(locale, query.month))
}
