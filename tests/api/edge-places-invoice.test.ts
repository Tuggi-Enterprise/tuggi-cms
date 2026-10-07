/**
 * #901 — NFS-e of the Com história plan (`_shared/places-invoice.ts`), against
 * `docs/contracts/places-pagamento.md` §3.5 (workspace). Minimal: the status mapping into
 * `partner.record_place_invoice`. Full coverage is the qa's.
 *
 * Deno source, loaded through a path built at run time: a static `.ts` import fails the repo's `tsc`.
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let inv: any

before(async () => {
  inv = await import(pathToFileURL(resolve(import.meta.dirname, '../../supabase/functions/_shared/places-invoice.ts')).href)
})

const SUB_UUID = '11111111-2222-4333-8444-555555555555'

test('#901 BR-B2B-046: every Asaas invoice status maps 1:1 to the mirror; an unknown one is null, never a guess', () => {
  for (const s of ['SCHEDULED', 'SYNCHRONIZED', 'AUTHORIZED', 'PROCESSING_CANCELLATION', 'CANCELED', 'CANCELLATION_DENIED', 'ERROR']) {
    assert.equal(inv.invoiceStatus(s), s)
  }
  assert.equal(inv.invoiceStatus(' authorized '), 'AUTHORIZED')
  assert.equal(inv.invoiceStatus('CANCELLED'), null)
  assert.equal(inv.invoiceStatus('PENDING'), null)
  assert.equal(inv.invoiceStatus(undefined), null)
})

test('#901 BR-B2B-046: record_place_invoice args come from the re-read invoice; no payment → nothing to record', () => {
  const a = inv.invoiceRecordArgs(
    { id: 'inv_1', status: 'AUTHORIZED', payment: 'pay_1', externalReference: SUB_UUID, value: 99.9, effectiveDate: '2026-10-31', number: '42', pdfUrl: 'https://x/pdf', xmlUrl: null, statusDescription: '' },
    'AUTHORIZED',
  )
  assert.deepEqual(a, {
    p_provider_invoice_id: 'inv_1',
    p_provider_payment_id: 'pay_1',
    p_subscription_id: SUB_UUID,
    p_status: 'AUTHORIZED',
    p_number: '42',
    p_pdf_url: 'https://x/pdf',
    p_xml_url: null,
    p_effective_date: '2026-10-31',
    p_status_description: null,
    p_amount_cents: 9990,
  })
  assert.equal(inv.invoiceRecordArgs({ id: 'inv_2', status: 'SCHEDULED', payment: null }, 'SCHEDULED'), null)
})

test('#901: the invoice secrets are all-or-nothing, and the ISS rate stays within 0–5 %', () => {
  const env = (o: Record<string, string>) => (n: string) => o[n]
  const full = { ASAAS_INVOICE_SERVICE_CODE: '1.03', ASAAS_INVOICE_SERVICE_NAME: 'Processamento de dados', ASAAS_INVOICE_ISS_RATE: '2,5' }
  assert.deepEqual(inv.parseInvoiceConfig(env(full)), { serviceCode: '1.03', serviceName: 'Processamento de dados', issRate: 2.5 })
  assert.equal(inv.parseInvoiceConfig(env({ ...full, ASAAS_INVOICE_ISS_RATE: '' })), null)
  assert.equal(inv.parseInvoiceConfig(env({ ...full, ASAAS_INVOICE_ISS_RATE: '25' })), null)
  assert.equal(inv.parseInvoiceConfig(env({ ...full, ASAAS_INVOICE_SERVICE_CODE: ' ' })), null)
})
