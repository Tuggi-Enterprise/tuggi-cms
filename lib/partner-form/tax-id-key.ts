/**
 * The deduplication key of a CNPJ — the TypeScript side of one expression that lives in the
 * database.
 *
 * THE OWNER IS `core.partner_form_submissions.tax_id_normalized`, written in migration
 * `20260814140000_issue341_proposta_do_parceiro_em_formulario_unico`:
 *
 *     upper(regexp_replace(coalesce(answers ->> 'tax_id', ''), '[^0-9A-Za-z]', '', 'g'))
 *
 * IT IS A COLUMN `DEFAULT`, NOT `GENERATED ALWAYS ... STORED`, and this docstring said the wrong
 * one until #396 measured it on the live database (2026-08-17). The difference is the whole
 * safety of the key: `GENERATED ALWAYS` REFUSES an INSERT that supplies the column, while a
 * DEFAULT only applies when the INSERT omits it. So a writer that sends `tax_id_normalized`
 * wins — the row keeps whatever the caller said, the filter below stops finding that company,
 * and nothing errors. The writer today is another repository
 * (`tuggi-enterprise/src/lib/partner-proposal/proposal-service.ts`), which never sends the
 * column and has a test that proves it; the contract that records the obligation is
 * `docs/contracts/partner-proposal-answers.md`.
 *
 * This function exists because a filter has to be built from a value the database has not stored
 * yet (`tax_id_normalized=eq.<key>`), and PostgREST cannot apply an expression to the operand.
 * It is a MIRROR, not a second owner: when the two disagree the column wins.
 *
 * THE ORDER IS PART OF THE CONTRACT: strip everything outside `[0-9A-Za-z]`, and ONLY THEN
 * upper-case. Stripping first means the upper-casing only ever sees ASCII, so no case-folding
 * rule can reach the key — `ß` upper-cases to `SS` and `ﬁ` to `FI`, and either one would put the
 * same company under two keys depending on which end normalised it. Inverting the two lines is
 * the mutation `tests/api/partner-proposal.test.ts` exists to catch.
 *
 * WHY IT IS NOT `[^0-9]`: the CNPJ is alphanumeric from 31/07/2026 (IN RFB nº 2.229/2024) —
 * the first twelve positions accept `[A-Z0-9]` and only the two check digits stay numeric.
 * Digits alone collapse `12.ABC.345/01DE-35` and `12.AAD.345/01CN-35`, two valid CNPJs of two
 * different companies, into `123450135`, and the second one is then told it is already our
 * client. Measured by the `data` against the live database, not argued.
 *
 * RELATED, AND DELIBERATELY NOT THE SAME THING:
 *  · `lib/validation/cnpj.ts` owns whether a CNPJ IS VALID (`isValidCnpj`) and the mask.
 *  · `cnpjLookupValues`, in that same module, answers a different question — which stored
 *    SHAPES to match in `core.clients.tax_id`, a plain column with no normalised twin and rows
 *    typed by hand carrying the printed mask. That one cannot be replaced by this key: there is
 *    no column on `core.clients` to compare it against.
 */

/** `12.abc.345/01de-35` → `12ABC34501DE35`. Empty string when there is nothing left. */
export function normalizedTaxId(value: string | null | undefined): string {
  return (value ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()
}
