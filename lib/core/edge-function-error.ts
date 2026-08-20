/**
 * The message the Edge Function actually sent, dug out of a supabase-js error.
 *
 * WHY THIS EXISTS: on any non-2xx, supabase-js throws `FunctionsHttpError` whose `message` is the
 * fixed string "Edge Function returned a non-2xx status code" — the status is gone, the body is
 * gone, and that is exactly what the operator sees in the CMS. Meanwhile the function answered
 * `{ "error": "No description found for attraction <id>." }`, which is the whole diagnosis.
 * The response is kept on `error.context`; reading it is the only way to show it.
 *
 * It never throws and never returns an empty string: a body that is not JSON, or JSON without a
 * message, falls back to `null` and the caller keeps the generic message.
 */

export async function readEdgeFunctionError(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown } | null)?.context as
    | { json?: () => Promise<unknown>; clone?: () => { json: () => Promise<unknown> } }
    | undefined
  if (!context || typeof context.json !== 'function') return null

  try {
    // Cloned when possible: the body is a stream, and reading it here would empty it for anyone
    // else holding the same response.
    const source = typeof context.clone === 'function' ? context.clone() : context
    const body = (await source.json!()) as { error?: unknown; message?: unknown } | null
    const message = body?.error ?? body?.message
    if (typeof message !== 'string') return null
    const trimmed = message.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}
