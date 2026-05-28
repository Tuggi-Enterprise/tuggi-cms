import { redirect } from 'next/navigation'

export default function NonLocaleCouponsRedirect() {
  redirect('/en/admin/coupons')
}
