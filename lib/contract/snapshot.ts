/**
 * The frozen contract — #342.
 *
 * THE ONE THING THIS MODULE EXISTS FOR (BR-B2B-017, item 5): the monthly fee is a
 * configurable field of the client registration, and the contract is NOT that field. A
 * snapshot is taken when the contract is generated, it is stored on the contract row, and
 * every later render — page, PDF, e-mail, audit trail — reads the snapshot and never the
 * registration. Editing `core.clients` afterwards changes the value of the NEXT contract
 * or amendment and nothing else, which is why the hash of a signed PDF keeps proving what
 * was accepted.
 *
 * Freezing at generation rather than at acceptance is the stricter of the two and the only
 * honest one: the partner reads a document and signs THAT document. A value that could
 * still move between "sent for signature" and "signed" would mean the text on screen was
 * not the text agreed to. Acceptance therefore freezes nothing new — it records who
 * accepted the already-frozen document, and when.
 *
 * Nothing here writes anything. It is pure so that the freeze can be proven by a test
 * without a database.
 */

import type { Client } from '@/types/clients'

export type ContractTier = 'free' | 'paid'

/** BR-B2B-017, 3rd edge case: the two means the operator named, and no third. */
export type PaymentMethod = 'boleto' | 'pix'

/**
 * The Tuggi side of the contract.
 *
 * It is not in the repository because it is not the repository's fact: the registration
 * data of the company lives with the operator (CLAUDE.md — commercial material is outside
 * the agents' reach). It arrives as configuration, and `contractChecklist` refuses to
 * generate anything while it is missing, instead of printing a plausible placeholder into
 * a document someone might sign.
 */
export interface ProviderParty {
  legalName: string
  taxId: string
  addressLine: string
  representativeName: string
  representativeRole: string
}

export function readProviderParty(env: Record<string, string | undefined> = process.env): ProviderParty | null {
  const legalName = env.TUGGI_LEGAL_NAME?.trim()
  const taxId = env.TUGGI_TAX_ID?.trim()
  const addressLine = env.TUGGI_ADDRESS?.trim()
  const representativeName = env.TUGGI_REPRESENTATIVE_NAME?.trim()
  const representativeRole = env.TUGGI_REPRESENTATIVE_ROLE?.trim()

  if (!legalName || !taxId || !addressLine || !representativeName || !representativeRole) return null
  return { legalName, taxId, addressLine, representativeName, representativeRole }
}

/** The partner side, copied out of the registration at generation time. */
export interface PartnerParty {
  clientId: string
  legalName: string
  tradeName: string | null
  taxId: string
  addressLine: string
  representativeName: string
  representativeRole: string
}

/**
 * Everything the template is allowed to read. If a clause needs a fact, the fact is a
 * field here — a clause that reaches for `core.clients` at render time would unfreeze the
 * document.
 */
export interface ContractSnapshot {
  templateVersion: string
  tier: ContractTier
  provider: ProviderParty
  partner: PartnerParty
  /** `null` on the free tier and on a courtesy contract. Absent is not zero (BR-B2B-017, item 6). */
  monthlyFeeCents: number | null
  isCourtesy: boolean
  courtesyReason: string | null
  paymentMethod: PaymentMethod | null
  /** BR-MONETIZACAO-039: read from the registration, never a literal in the template. */
  commissionRate: number
  /** BR-B2B-021, item 2: the delivery of QR and display needs a written deadline. */
  qrDeliveryDays: number
  /** Server clock, ISO 8601. The template prints it; nothing recomputes it. */
  generatedAt: string
}

/** What the operator chooses on the generation form. The rest comes from the registration. */
export interface GenerationChoices {
  tier: ContractTier
  paymentMethod: PaymentMethod | null
  qrDeliveryDays: number | null
}

/**
 * The closed list of BR-B2B-022, item 3, as evidence rather than as belief.
 *
 * It does NOT live on the client record, and that is the point: the licence and the
 * incorporation document are files the partner sent through the #341 form, and their
 * validity date is an answer in that submission. Reading them from a boolean column on
 * `core.clients` would mean trusting a flag somebody set by hand.
 */
export interface RegularityEvidence {
  businessLicenseDocument: boolean
  incorporationDocument: boolean
  /** ISO date from the partner's answer. `null` is "not informed", which is a blocker. */
  businessLicenseValidUntil: string | null
}

export type ContractClient = Client

/** One missing thing, and where the operator resolves it. */
export interface ChecklistItem {
  id: string
  label: string
  where: string
}

export interface ChecklistResult {
  ready: boolean
  missing: ChecklistItem[]
}

/**
 * BR-B2B-022, item 3 (the entry gate is a closed list of documents) plus BR-B2B-017,
 * item 6 (absent is not zero) plus BR-B2B-023, item 2 (nobody names the adjustment index).
 *
 * The blocking is deliberate: "generate anyway and fix later" produces a signed PDF with a
 * hole in it, and a signed PDF is the one artefact in this feature that cannot be edited.
 */
export function contractChecklist(
  client: ContractClient | null,
  choices: GenerationChoices,
  options: { provider: ProviderParty | null; regularity: RegularityEvidence; now?: Date }
): ChecklistResult {
  const missing: ChecklistItem[] = []
  const now = options.now ?? new Date()

  if (!options.provider) {
    missing.push({
      id: 'provider',
      label: 'Dados da Tuggi (razão social, CNPJ, endereço e representante) não configurados',
      where: 'configuração do ambiente',
    })
  }

  if (!client) {
    missing.push({ id: 'client', label: 'Cadastro do cliente não encontrado', where: 'lista de clientes' })
    return { ready: false, missing }
  }

  if (!client.tax_id?.trim()) {
    missing.push({ id: 'tax_id', label: 'CNPJ do estabelecimento', where: 'aba Fiscal e Pagamentos' })
  }

  if (!client.company_name?.trim() && !client.name?.trim()) {
    missing.push({ id: 'legal_name', label: 'Razão social do estabelecimento', where: 'aba Perfil' })
  }

  if (!client.address?.trim()) {
    missing.push({ id: 'address', label: 'Endereço do estabelecimento', where: 'aba Perfil' })
  }

  if (!client.legal_representative_name?.trim()) {
    missing.push({ id: 'representative_name', label: 'Nome do representante legal', where: 'aba Fiscal e Pagamentos' })
  }

  if (!client.legal_representative_role?.trim()) {
    missing.push({ id: 'representative_role', label: 'Cargo do representante legal', where: 'aba Fiscal e Pagamentos' })
  }

  // BR-B2B-022, item 3: "documento vencido é ausência".
  const regularity = options.regularity
  if (!regularity.businessLicenseDocument) {
    missing.push({ id: 'business_license', label: 'Alvará de funcionamento anexado', where: 'formulário do parceiro' })
  } else if (!regularity.businessLicenseValidUntil) {
    missing.push({
      id: 'business_license_validity',
      label: 'Validade do alvará preenchida',
      where: 'formulário do parceiro',
    })
  } else if (new Date(regularity.businessLicenseValidUntil).getTime() <= now.getTime()) {
    missing.push({
      id: 'business_license_expired',
      label: 'Alvará vencido — pedir o vigente ao parceiro',
      where: 'formulário do parceiro',
    })
  }

  if (!regularity.incorporationDocument) {
    missing.push({ id: 'incorporation', label: 'Documento de constituição anexado', where: 'formulário do parceiro' })
  }

  if (typeof client.commission_rate !== 'number') {
    missing.push({ id: 'commission_rate', label: 'Percentual de comissão', where: 'aba Fiscal e Pagamentos' })
  }

  if (choices.qrDeliveryDays === null || !Number.isInteger(choices.qrDeliveryDays) || choices.qrDeliveryDays <= 0) {
    missing.push({ id: 'qr_delivery', label: 'Prazo de entrega do QR e do display, em dias', where: 'esta página' })
  }

  if (choices.tier === 'paid') {
    if (!choices.paymentMethod) {
      missing.push({ id: 'payment_method', label: 'Forma de pagamento (boleto ou Pix)', where: 'esta página' })
    }

    // Absent is incomplete registration; zero without the courtesy decision is the same
    // thing wearing a number. Only the marked courtesy, with a reason, is a decision.
    const courtesy = client.is_courtesy === true
    const fee = client.monthly_fee_cents

    if (courtesy) {
      if (!client.courtesy_reason?.trim()) {
        missing.push({ id: 'courtesy_reason', label: 'Motivo da cortesia', where: 'aba Fiscal e Pagamentos' })
      }
    } else if (typeof fee !== 'number' || !Number.isFinite(fee) || fee <= 0) {
      missing.push({
        id: 'monthly_fee',
        label:
          typeof fee === 'number' && fee === 0
            ? 'Valor mensal: zero digitado não vale como cortesia — marque "Cortesia (sem mensalidade)" com o motivo'
            : 'Valor mensal do contrato',
        where: 'aba Fiscal e Pagamentos',
      })
    }
  }

  return { ready: missing.length === 0, missing }
}

/**
 * Builds the snapshot. Call it only after `contractChecklist` says ready — it throws
 * otherwise, because a snapshot with a hole in it is the thing this module exists to
 * prevent.
 */
export function buildSnapshot(
  client: ContractClient,
  choices: GenerationChoices,
  options: { provider: ProviderParty; regularity: RegularityEvidence; templateVersion: string; now?: Date }
): ContractSnapshot {
  const check = contractChecklist(client, choices, {
    provider: options.provider,
    regularity: options.regularity,
    now: options.now,
  })
  if (!check.ready) {
    throw new Error(`contract snapshot refused: ${check.missing.map((item) => item.id).join(', ')}`)
  }

  const courtesy = client.is_courtesy === true

  return {
    templateVersion: options.templateVersion,
    tier: choices.tier,
    provider: options.provider,
    partner: {
      clientId: client.id,
      legalName: (client.company_name?.trim() || client.name.trim()) as string,
      tradeName: client.name?.trim() || null,
      taxId: client.tax_id!.trim(),
      addressLine: [client.address, client.city, client.state, client.postal_code]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(', '),
      representativeName: client.legal_representative_name!.trim(),
      representativeRole: client.legal_representative_role!.trim(),
    },
    monthlyFeeCents: choices.tier === 'paid' && !courtesy ? (client.monthly_fee_cents as number) : null,
    isCourtesy: choices.tier === 'paid' ? courtesy : false,
    courtesyReason: choices.tier === 'paid' && courtesy ? (client.courtesy_reason?.trim() ?? null) : null,
    paymentMethod: choices.tier === 'paid' && !courtesy ? choices.paymentMethod : null,
    commissionRate: client.commission_rate as number,
    qrDeliveryDays: choices.qrDeliveryDays as number,
    generatedAt: (options.now ?? new Date()).toISOString(),
  }
}

/**
 * Does the registration still say what the signed contract says?
 *
 * The answer drives two notes the `design` specified — one on the contract page, one next
 * to the field in `FiscalPaymentsTab` — and both only appear when the two diverge.
 */
export function feeDivergence(
  snapshot: Pick<ContractSnapshot, 'monthlyFeeCents' | 'isCourtesy'>,
  client: Pick<Client, 'monthly_fee_cents' | 'is_courtesy'>
): { diverges: boolean; registrationFeeCents: number | null } {
  const registrationFeeCents =
    client.is_courtesy === true ? null : typeof client.monthly_fee_cents === 'number' ? client.monthly_fee_cents : null

  if (snapshot.isCourtesy) {
    return { diverges: client.is_courtesy !== true, registrationFeeCents }
  }
  return { diverges: registrationFeeCents !== snapshot.monthlyFeeCents, registrationFeeCents }
}

/** R$ 1.234,56 — the only currency of this contract is the real (BR-B2B-017, 1st edge case). */
export function formatFee(cents: number | null): string {
  if (cents === null) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

/** dd/mm/aaaa in Brasília time, which is the timezone every date in this document means. */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' }).format(new Date(iso))
}

/** dd/mm/aaaa às hh:mm (horário de Brasília) — the stamp the receipt and the trail show. */
export function formatDateTime(iso: string): string {
  const formatted = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso))
  return `${formatted} (horário de Brasília)`
}

/** 12.345.678/0001-95, and it leaves an alphanumeric CNPJ alone if it is not 14 long. */
export function formatTaxId(taxId: string): string {
  const raw = taxId.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (raw.length !== 14) return taxId
  return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12)}`
}

/** 20,00% — the rate is stored as a fraction and shown as a percentage. */
export function formatCommissionRate(rate: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 2 }).format(rate)
}
