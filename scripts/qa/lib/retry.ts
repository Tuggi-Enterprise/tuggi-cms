/**
 * `auth.admin.listUsers` on this project answered an intermittent bare 500
 * (`AuthRetryableFetchError`, no body) during CARD-CMS-01 testing on
 * 2026-08-05 — reproducible standalone, not tied to page size or call
 * order. Shared by seed and cleanup so the backoff policy has one owner
 * (CLAUDE.md §6, SSOT) instead of drifting between the two scripts.
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** i))
    }
  }
  throw lastErr
}
