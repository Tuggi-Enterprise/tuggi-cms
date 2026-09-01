/**
 * The character a CMS screen prints when it does not have the value — and nothing else.
 *
 * It was already the convention (`appUserLabel`, `PaidAccessCard`, `MeteredBalances`, the
 * user file), typed out as a literal in each place. That is survivable for a punctuation
 * mark right up to the moment somebody types a hyphen instead of an em dash and two cells
 * in the same table stop looking like the same statement.
 *
 * **It means "I do not have this", never "this is zero".** Zero is a measurement and has its
 * own rendering — `formatDuration` returns `0 min`. Choosing between the two is choosing
 * which fact you hold, and the dashboard's RPCs make that choice load-bearing: they gain
 * columns before the migration reaches this repo, so a column that did not come back is
 * `null`, and `null` prints as this (`optionalMinutes` in `lib/services/dashboard-service.ts`).
 *
 * Not a mutirão: the literals outside `lib/format` stay where they are until someone edits
 * that file for another reason.
 */
export const UNKNOWN_VALUE = '—'
