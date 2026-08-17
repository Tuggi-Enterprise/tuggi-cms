/**
 * Where an operator reached from a pipeline goes back to — DS-LAYOUT-006, point 2.
 *
 * A specialised tool opened from a queue has to declare the way back with a VISIBLE control,
 * not the browser's back button: `returnTo` is the path and `returnLabel` is the whole
 * sentence, already composed by the caller. The caller composes it because the partnership
 * copy lives only in `messages/pt.json` under `Partnerships`, while the tools it links to keep
 * the operator's locale — growing a Portuguese-only namespace inside each tool would be the
 * same text in two places.
 *
 * ONE MODULE AND NOT A REGEX PER SCREEN. The rule that `returnTo` must be an in-app path is a
 * SECURITY decision, not a formatting one: a `returnTo` that starts with `//` or `/\` is read
 * by the browser as a protocol-relative URL and bounces an authenticated operator to another
 * origin. It was written inline on the POI screen first; the second screen to need it is what
 * makes copying it a defect (CLAUDE.md §6, DRY).
 */

/** The two query keys, named once so no caller spells them by hand. */
export const RETURN_TO_PARAM = 'returnTo'
export const RETURN_LABEL_PARAM = 'returnLabel'

/**
 * The path to go back to, or `null` when there is none to trust.
 *
 * Accepts one leading `/` followed by anything that is not another `/` or a `\`. That rejects
 * `//evil.com` and `/\evil.com` — both of which browsers resolve as another origin — and every
 * absolute URL, while accepting the in-app paths the CMS actually links with.
 */
export function parseReturnTo(raw: string | null | undefined): string | null {
  return raw && /^\/[^/\\]/.test(raw) ? raw : null
}

/**
 * The sentence to print on the control. Tied to the path on purpose: a label with nowhere to go
 * is a button that lies, so an untrusted `returnTo` takes its label down with it.
 */
export function parseReturnLabel(
  rawLabel: string | null | undefined,
  returnTo: string | null
): string | null {
  return returnTo ? rawLabel ?? null : null
}

/**
 * The pair as query parameters, for whoever is building the link. The label only travels when
 * there is one — an empty `returnLabel=` in the URL would render an empty control.
 */
export function returnParams(
  returnTo: string,
  returnLabel?: string | null
): Record<string, string> {
  const params: Record<string, string> = { [RETURN_TO_PARAM]: returnTo }
  if (returnLabel) params[RETURN_LABEL_PARAM] = returnLabel
  return params
}
