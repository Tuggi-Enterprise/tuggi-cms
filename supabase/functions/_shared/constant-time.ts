// _shared/constant-time.ts
//
// The one string comparison for secrets in the Edge Functions. A `===` or an
// `Array.includes` stops at the first byte that differs, and the time it takes
// tells an attacker how much of a guess was right. This walks the longer of the
// two inputs whatever happens; only the LENGTH of the expected value can leak,
// and a secret's length is not the secret.
//
// Pure and import-free on purpose: the CMS tests load it under Node (`tsx`).

export function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}
