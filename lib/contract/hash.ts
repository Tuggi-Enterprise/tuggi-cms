/**
 * The hash the whole proof hangs from — #342.
 *
 * SHA-256 in hexadecimal, lowercase, of the PDF bytes AS STORED. It is recorded on the
 * acceptance row and it is what `Conferir integridade` recomputes from the archived file.
 * There is no salt and no secret: the claim is integrity, not authentication, and a
 * verifier outside the Tuggi has to be able to reproduce the number with `sha256sum`.
 */

import { createHash } from 'node:crypto'

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * The "código de verificação" the receipt shows and the e-mail repeats. It is a reading
 * aid — the full hash is what proves anything, and it is always available next to it.
 */
export function shortHash(hex: string): string {
  return hex.slice(0, 12).toUpperCase()
}

/** 64 lowercase hex characters. Anything else never came out of `sha256Hex`. */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}
