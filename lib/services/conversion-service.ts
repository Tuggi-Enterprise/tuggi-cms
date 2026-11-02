import { getSupabaseClient } from '@/lib/core/supabase-client'
import { parseConversionFunnel, type ConversionFunnel } from '@/lib/conversion/funnel'

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
}

export default conversionService
