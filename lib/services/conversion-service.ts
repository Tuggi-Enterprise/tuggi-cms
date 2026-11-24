import { getSupabaseClient } from '@/lib/core/supabase-client'
import { parseConversionFunnel, type ConversionFunnel } from '@/lib/conversion/funnel'
import { parseFreeMinutesHistogram, type FreeMinutesHistogram } from '@/lib/engagement/free-minutes'

/**
 * PostgREST's answer for a function it does not know: the migration of #1155 is not applied yet.
 * That is "no source" on screen, never an error card and never zeros (BR-COMUNICACAO-022 item 4).
 */
export const FUNCTION_NOT_DEPLOYED = 'PGRST202'

/**
 * conversion-service: one month of the Conversion report (#1068), from install to purchase.
 *
 * Reads `core.dashboard_conversion_funnel(p_month)`. The arithmetic (rates, floor, unknown) lives
 * in `lib/conversion/funnel.ts`; this file only fetches and hands the jsonb to its parser.
 * supabase-js resolves with `{ error }` and never rejects, so the error is read off the result.
 */
export const conversionService = {
  /** `month` is the first day of the month, YYYY-MM-DD. */
  async get(month: string): Promise<{ success: boolean; data?: ConversionFunnel; error?: string }> {
    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .schema('core')
        .rpc('dashboard_conversion_funnel', { p_month: month })
      if (error) return { success: false, error: error.message }
      return { success: true, data: parseConversionFunnel(data) }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('Error fetching conversion funnel:', message)
      return { success: false, error: message }
    }
  },

  /**
   * One month of `core.cms_get_free_minutes_histogram(p_month)` (#1156), `month` as YYYY-MM.
   * `data: null` = the function is not deployed yet.
   */
  async freeMinutes(month: string): Promise<{ success: boolean; data?: FreeMinutesHistogram | null; error?: string }> {
    try {
      const { data, error } = await getSupabaseClient()
        .schema('core')
        .rpc('cms_get_free_minutes_histogram', { p_month: month })
      if (error) return error.code === FUNCTION_NOT_DEPLOYED ? { success: true, data: null } : { success: false, error: error.message }
      return { success: true, data: parseFreeMinutesHistogram(data) }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('Error fetching free minutes histogram:', message)
      return { success: false, error: message }
    }
  },
}

export default conversionService
