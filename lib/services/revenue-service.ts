import { getSupabaseClient } from '@/lib/core/supabase-client'
import { FUNCTION_NOT_DEPLOYED } from '@/lib/services/conversion-service'
import { parseRevenueReport, revenueWindow, type RevenueReport } from '@/lib/revenue/monthly'

/**
 * revenue-service: the twelve months of the Revenue page (#1157), from `core.cms_get_revenue_monthly`.
 * The admin session calls it, as the funnel (the function gates with `core.assert_platform_admin()`).
 * supabase-js resolves with `{ error }` and never rejects, so the error is read off the result.
 */
export const revenueService = {
  /** `month` is the chosen month, YYYY-MM. `data: null` = the function is not deployed yet. */
  async get(month: string): Promise<{ success: boolean; data?: RevenueReport | null; error?: string }> {
    try {
      const { from, to } = revenueWindow(month)
      const { data, error } = await getSupabaseClient()
        .schema('core')
        .rpc('cms_get_revenue_monthly', { p_from: from, p_to: to })
      if (error) return error.code === FUNCTION_NOT_DEPLOYED ? { success: true, data: null } : { success: false, error: error.message }
      return { success: true, data: parseRevenueReport(data) }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('Error fetching revenue:', message)
      return { success: false, error: message }
    }
  },
}

export default revenueService
