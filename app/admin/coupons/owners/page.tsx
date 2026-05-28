import { redirect } from 'next/navigation'

export default function NonLocaleCouponOwnersRedirect() {
  redirect('/en/admin/coupons/owners')
}
