/**
 * Harness for `coupon-redemptions.spec.tsx` (#787). Mounts the cards + table of the redemptions
 * page without fetching or routing, in the language asked, with ONLY the `Coupons` namespace —
 * next-intl renders the key name for a missing namespace, and a test must not pass against it.
 */
import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'
import esMessages from '@/messages/es.json'
import enMessages from '@/messages/en.json'
import { CouponRedemptionsView } from '@/components/admin/AdminCouponRedemptionsPageContent'
import { summarizeRedemptions, type CouponRedemption } from '@/lib/coupons/redemptions'

export function RedemptionsHarness({
  rows,
  locale = 'pt',
  filtered = false,
  unavailable = false,
}: {
  rows: CouponRedemption[]
  locale?: 'pt' | 'en' | 'es'
  filtered?: boolean
  unavailable?: boolean
}) {
  const file = locale === 'es' ? esMessages : locale === 'en' ? enMessages : ptMessages
  return (
    <NextIntlClientProvider locale={locale} messages={{ Coupons: file.Coupons }}>
      <CouponRedemptionsView
        rows={rows}
        totals={summarizeRedemptions(rows)}
        loading={false}
        error={null}
        unavailable={unavailable}
        filtered={filtered}
        onFilterByCode={() => {}}
        onClearFilters={() => {}}
      />
    </NextIntlClientProvider>
  )
}
