/**
 * THE ADDRESS OF A TOURIST'S RECORD: `/users/app?user=<user_id>&tab=<tab>` (#976).
 *
 * The record is a drawer over the app users list, the same shape as the client record over
 * `/admin/clients?clientId=&tab=`. The old Passaporte page (`/admin/users/<id>`) survives only as
 * a redirect to this address with `tab=passport`, so links already out there land on the drawer.
 *
 * Nothing here is React and nothing fetches: `tests/api/app-user-href.test.ts` proves it without a
 * browser.
 */

/** The four tabs of the record, in the order they are drawn. */
export const APP_USER_TABS = ['overview', 'passport', 'credit', 'client'] as const

export type AppUserTab = (typeof APP_USER_TABS)[number]

/** The query parameters the drawer owns on the list's address. */
export const APP_USER_PARAM = 'user'
export const APP_USER_TAB_PARAM = 'tab'

/** A missing or unknown `?tab=` opens the overview, never an empty panel. */
export function appUserTab(raw: string | null | undefined): AppUserTab {
  return (APP_USER_TABS as readonly string[]).includes(raw ?? '') ? (raw as AppUserTab) : 'overview'
}

function listPath(locale?: string | null): string {
  return locale ? `/${locale}/users/app` : '/users/app'
}

/** The list with the drawer open on `userId`, keeping whatever else the list's query carried. */
export function appUserHref(
  userId: string,
  tab: AppUserTab,
  options: { locale?: string | null; current?: URLSearchParams } = {}
): string {
  const params = new URLSearchParams(options.current?.toString() ?? '')
  params.set(APP_USER_PARAM, userId)
  params.set(APP_USER_TAB_PARAM, tab)
  return `${listPath(options.locale)}?${params.toString()}`
}

/** The list with the drawer closed: the drawer's two parameters go, the rest stays. */
export function appUserListHref(current: URLSearchParams, locale?: string | null): string {
  const params = new URLSearchParams(current.toString())
  params.delete(APP_USER_PARAM)
  params.delete(APP_USER_TAB_PARAM)
  const query = params.toString()
  return query ? `${listPath(locale)}?${query}` : listPath(locale)
}
