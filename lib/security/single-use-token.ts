/**
 * How a single-use link token is minted, stored and shape-checked.
 *
 * One decision, two features: the partner form invite (#341) and the contract signing link
 * (#342). It lives here because it is a fact with one owner — "what a Tuggi link token is"
 * — and the day the length, the alphabet or the digest changes, it has to change in one
 * place or the two features quietly stop agreeing on what a valid link looks like.
 *
 *  - 32 bytes from the CSPRNG, base64url: 256 bits of entropy in a URL-safe segment, so
 *    there is nothing to guess and nothing to encode.
 *  - Stored as SHA-256, never raw. The raw token exists in the e-mail and in the URL and
 *    nowhere else, so a database dump does not hand anyone a working link.
 *  - No salt, on purpose: the input is 256 random bits, so there is no dictionary to run
 *    against it, and the lookup has to stay a single indexed equality.
 *
 * There is no constant-time comparison here, also on purpose. Nothing compares two hashes
 * in JavaScript: the SHA-256 goes to Postgres and the indexed equality decides.
 */

import { createHash, randomBytes } from 'node:crypto'

export function generateSingleUseToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashSingleUseToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Shape check before the database is touched. A token that cannot be one of ours is not
 * worth a round trip, and answering "invalid" without querying keeps a scan cheap for us
 * instead of cheap for the scanner.
 */
export function isWellFormedSingleUseToken(token: string): boolean {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{40,64}$/.test(token)
}
