import { redirect } from 'next/navigation'
import { appUserHref } from '@/lib/users/app-user-href'

/** The localized twin of `app/admin/users/[userId]/page.tsx`: a redirect to the drawer (#976). */
export default async function LocalizedAdminUserPassportPage({
  params,
}: {
  params: Promise<{ locale: string; userId: string }>
}) {
  const { locale, userId } = await params
  redirect(appUserHref(userId, 'passport', { locale }))
}
