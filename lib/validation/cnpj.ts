/**
 * CNPJ — alphanumeric, as it exists since 2026-07-31.
 *
 * Port of the reference implementation published by Serpro
 * (https://github.com/serpro-repos/CNPJ-Alfa-Calc-DV, `src/typescript/cnpj.ts`,
 * consulted 2026-08-14), which implements Instrução Normativa RFB nº 2.229/2024.
 * The algorithm is NOT rewritten from memory: the weights, the ASCII base and the
 * `< 2 → 0` rule of the modulo 11 are the reference's, and `CNPJ_REFERENCE_VECTORS`
 * below is the reference's own test list, kept so a future edit that "simplifies"
 * the loop fails loudly.
 *
 * What changes versus the old numeric CNPJ, and why every shortcut breaks:
 *
 * - Positions 1–12 accept `[A-Z0-9]`; only the two check digits stay numeric. So
 *   `^\d{14}$`, `type="number"` and `inputmode="numeric"` reject a valid company —
 *   and pass every test written with pre-2026 data.
 * - Each character is worth its ASCII code minus 48, so `0`–`9` keep their old
 *   value (that is what makes the algorithm backwards compatible) and `A` = 17,
 *   `B` = 18, and so on.
 *
 * Lowercase: the reference refuses it. This module refuses it too in `isValidCnpj`,
 * and `normalizeCnpj` is the documented, single place where a typed `abc` becomes
 * `ABC` — the form upper-cases as the person types (spec do `design`
 * spec-parceria-formulario-e-contrato-2026-08, §3.2), so validation never sees
 * lowercase in practice, and a caller that skips normalisation gets the strict
 * behaviour rather than a silent guess.
 */

/** Length without the two check digits. */
const BASE_LENGTH = 12

/** Full length, mask removed. */
export const CNPJ_LENGTH = 14

/** `0`.charCodeAt(0) — the "minus 48" of the Receita Federal note. */
const ASCII_BASE = '0'.charCodeAt(0)

/** Modulo 11 weights. Index 0 is only used by the second check digit. */
const DV_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]

const MASK_CHARS = /[./-]/g
const DISALLOWED_CHARS = /[^A-Z\d./-]/i
const BASE_PATTERN = /^[A-Z\d]{12}$/
const FULL_PATTERN = /^[A-Z\d]{12}\d{2}$/
const ALL_ZEROS = '00000000000000'

/**
 * Uppercases and strips the mask. The only place where case is decided, so that
 * "we accept lowercase" is a product decision written once instead of a `toUpperCase()`
 * scattered over call sites.
 */
export function normalizeCnpj(value: string): string {
  return (value ?? '').replace(MASK_CHARS, '').toUpperCase()
}

/**
 * Computes the two check digits of a 12-character CNPJ root.
 * Throws when the root is not a valid root — same contract as the reference.
 */
export function calculateCnpjCheckDigits(root: string): string {
  if (DISALLOWED_CHARS.test(root)) {
    throw new Error('CNPJ root has characters that are not allowed')
  }

  const clean = root.replace(MASK_CHARS, '')
  if (!BASE_PATTERN.test(clean) || clean === ALL_ZEROS.slice(0, BASE_LENGTH)) {
    throw new Error('CNPJ root is not valid')
  }

  let sumFirst = 0
  let sumSecond = 0
  for (let i = 0; i < BASE_LENGTH; i++) {
    const value = clean.charCodeAt(i) - ASCII_BASE
    sumFirst += value * DV_WEIGHTS[i + 1]
    sumSecond += value * DV_WEIGHTS[i]
  }

  const first = sumFirst % 11 < 2 ? 0 : 11 - (sumFirst % 11)
  sumSecond += first * DV_WEIGHTS[BASE_LENGTH]
  const second = sumSecond % 11 < 2 ? 0 : 11 - (sumSecond % 11)

  return `${first}${second}`
}

/**
 * True when `cnpj` is a valid CNPJ, with or without mask. Uppercase only, by the
 * reference's contract — call `normalizeCnpj` first if the input came from a keyboard.
 */
export function isValidCnpj(cnpj: string): boolean {
  if (!cnpj || DISALLOWED_CHARS.test(cnpj)) return false

  const clean = cnpj.replace(MASK_CHARS, '')
  if (!FULL_PATTERN.test(clean) || clean === ALL_ZEROS) return false

  try {
    return clean.slice(BASE_LENGTH) === calculateCnpjCheckDigits(clean.slice(0, BASE_LENGTH))
  } catch {
    return false
  }
}

/** `12ABC34501DE35` → `12.ABC.345/01DE-35`. Partial input is masked as far as it goes. */
export function formatCnpj(value: string): string {
  const clean = normalizeCnpj(value).slice(0, CNPJ_LENGTH)
  const parts = [clean.slice(0, 2), clean.slice(2, 5), clean.slice(5, 8), clean.slice(8, 12), clean.slice(12, 14)]

  let out = parts[0]
  if (parts[1]) out += `.${parts[1]}`
  if (parts[2]) out += `.${parts[2]}`
  if (parts[3]) out += `/${parts[3]}`
  if (parts[4]) out += `-${parts[4]}`
  return out
}

/**
 * What the masked field keeps while someone types: `[A-Z0-9]` in the first twelve
 * positions, `[0-9]` in the last two. Anything else is dropped instead of refused,
 * so a pasted `12.ABC.345/01DE-35` lands whole.
 */
export function maskCnpjInput(value: string): string {
  const clean = normalizeCnpj(value).replace(/[^A-Z0-9]/g, '')
  const root = clean.slice(0, BASE_LENGTH).replace(/[^A-Z0-9]/g, '')
  const digits = clean.slice(BASE_LENGTH, CNPJ_LENGTH).replace(/\D/g, '')
  return formatCnpj(root + digits)
}

/** How many characters are still missing, for the "Faltam {n}" error of the spec. */
export function cnpjCharactersMissing(value: string): number {
  return Math.max(0, CNPJ_LENGTH - normalizeCnpj(value).replace(/[^A-Z0-9]/g, '').length)
}

/**
 * The reference's own vectors, verbatim from `src/typescript/test.ts`. They are the
 * proof that this port did not drift, and `12.ABC.345/01DE-35` is the official
 * alphanumeric example published by Serpro.
 */
export const CNPJ_REFERENCE_VECTORS = {
  valid: [
    '12.ABC.345/01DE-35',
    '90.021.382/0001-22',
    '90.024.778/0001-23',
    '90.025.108/0001-21',
    '90.025.255/0001-00',
    '90.024.420/0001-09',
    '90.024.781/0001-47',
    '04.740.714/0001-97',
    '44.108.058/0001-29',
    '90.024.780/0001-00',
    '90.024.779/0001-78',
    '00000000000191',
    'ABCDEFGHIJKL80',
  ],
  invalid: [
    '',
    "'!@#$%&*-_=+^~",
    '$0123456789ABC',
    '0123456?789ABC',
    '0123456789ABC#',
    '12.ABc.345/01DE-35',
    '0000000000019',
    '000000000001911',
    '0000000000019L',
    '000000000001P1',
    '00000000000192',
    'ABCDEFGHIJKL81',
    '00000000000000',
    '00.000.000/0000-00',
  ],
} as const
