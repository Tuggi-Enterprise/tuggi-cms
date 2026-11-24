import { redirect } from 'next/navigation'
import { appUserHref } from '@/lib/users/app-user-href'

/**
 * NOT A SCREEN ANY MORE (#976): the Passaporte is a tab of the tourist's record, the drawer over
 * the app users list. This address stays alive as a redirect so the links already out there land
 * on that drawer, on the Passaporte tab.
 */
export default async function AdminUserPassportPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  redirect(appUserHref(userId, 'passport'))
}
