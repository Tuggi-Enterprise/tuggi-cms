/**
 * What a `23505` on `partner.clients` actually means — one answer, read by every route that
 * writes that table.
 *
 * WHY THIS EXISTS AT ALL. Four routes translated every unique violation into
 * `409 "Email already exists"`, which was already imprecise (the same code comes out of the
 * slug and of `cms_user_id`) and became FALSE with `20260814160000`: `partner.clients.email`
 * stops being unique, because one owner has several places and each place is its own record.
 * After that migration the 409 that is left cannot be about e-mail, and a message that names
 * the wrong column sends whoever is debugging to the wrong field.
 *
 * WHY IT MAPS THE CONSTRAINT AND NOT THE COLUMN WE GUESSED. The message is built from what
 * the database reported, so it is true on both sides of the migration: while
 * `clients_email_key` still exists, a collision on it still says e-mail. Nothing here has to
 * be changed on the day the migration is applied — the constraint simply stops appearing.
 *
 * The names are the ones in `core`, measured in `20260719000000_baseline_remote_schema.sql`:
 * `clients_email_key`, `clients_cms_user_id_key` and the unique index `idx_clients_slug`.
 */

/** Postgres error as PostgREST hands it over. Only the three text fields matter here. */
export interface PostgresErrorLike {
  code?: string | null
  message?: string | null
  details?: string | null
  constraint?: string | null
}

export const CLIENT_UNIQUE_VIOLATION = '23505'

/**
 * Constraint name → what a human should be told. Ordered by how often it is hit; the lookup
 * is a substring match because PostgREST puts the name inside the message text.
 */
const CLIENT_UNIQUE_CONSTRAINTS: readonly { constraint: string; message: string }[] = [
  { constraint: 'idx_clients_slug', message: 'Slug already in use' },
  { constraint: 'clients_cms_user_id_key', message: 'This CMS user is already linked to a client' },
  { constraint: 'clients_email_key', message: 'Email already exists' },
]

/**
 * Says which unique constraint of `partner.clients` was violated, or null when the error is not
 * a unique violation at all.
 *
 * The fallback names no column ON PURPOSE. A constraint this function has not been told about
 * is a constraint somebody added, and inventing "email" for it is how the current lie got
 * here in the first place.
 */
export function describeClientUniqueViolation(error: PostgresErrorLike | null): string | null {
  if (!error || error.code !== CLIENT_UNIQUE_VIOLATION) return null

  const haystack = `${error.constraint ?? ''} ${error.message ?? ''} ${error.details ?? ''}`
  const known = CLIENT_UNIQUE_CONSTRAINTS.find((entry) => haystack.includes(entry.constraint))

  return known ? known.message : 'A unique field of this client record is already taken'
}
