import { redirect } from 'next/navigation'

/** Keeps `?coupon=&owner=` — the filter is the whole point of a link to this page (#787). */
export default async function NonLocaleCouponRedemptionsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') params.set(key, value)
  }
  const qs = params.toString()
  redirect(`/en/admin/coupons/redemptions${qs ? `?${qs}` : ''}`)
}
