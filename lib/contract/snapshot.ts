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
 * It comes from the SAME place as the partner side: a row of `core.clients`, the one flagged
 * `is_platform_owner`. That flag already had this meaning — `client-editable-fields.ts` says
 * "only Tuggi owns the platform" — and the five facts (razão social, CNPJ, endereço,
 * representante e cargo) are columns the operator edits in the client editor.
 *
 * It used to arrive as five environment variables, which made the address of the company a
 * deploy (#342, SSOT correction of 2026-08-16). Same fact, two owners, and the worse of the
 * two was winning. This module reads no configuration at all now, and a test asserts it.
 */
export interface ProviderParty {
  legalName: string
  taxId: string
  addressLine: string
  representativeName: string
  representativeRole: string
}

/**
 * What the lookup of the platform owner answered. `ambiguous` is deliberate: the `data`
 * side guarantees a single owner by partial unique index, and if a second one ever shows up
 * the honest answer is "configuração errada", not the first row of an arbitrary order.
 */
export type PlatformOwnerLookup =
  | { state: 'found'; client: ContractClient }
  | { state: 'absent' }
  | { state: 'ambiguous' }

export interface ProviderResolution {
  party: ProviderParty | null
  missing: ChecklistItem[]
}

/** Where each of the five is edited — the client editor has the address on another tab. */
const OWNER_PROFILE_TAB = 'aba Perfil do cliente marcado como dono da plataforma'
const OWNER_FISCAL_TAB = 'aba Fiscal e Pagamentos do cliente marcado como dono da plataforma'

/**
 * One pass over the owner registration: either the five facts, or the named holes.
 *
 * Single traversal on purpose — a "is it complete?" that walked the fields separately from
 * the one that builds the party is the second implementation of the same decision, and the
 * two would drift the first time a sixth field appears.
 */
export function resolvePlatformOwner(lookup: PlatformOwnerLookup): ProviderResolution {
  if (lookup.state === 'absent') {
    return {
      party: null,
      missing: [
        {
          id: 'platform_owner',
          label: 'Nenhum cliente marcado como dono da plataforma',
          where: 'cadastro da Tuggi, aba Fiscal e Pagamentos',
          target: { kind: 'client', clientId: null, tab: 'fiscal' },
        },
      ],
    }
  }

  if (lookup.state === 'ambiguous') {
    return {
      party: null,
      missing: [
        {
          id: 'platform_owner_ambiguous',
          label: 'Mais de um cliente marcado como dono da plataforma — só um pode ser',
          where: 'aba Fiscal e Pagamentos dos clientes marcados',
          target: { kind: 'client', clientId: null, tab: 'fiscal' },
        },
      ],
    }
  }

  const owner = lookup.client
  // The record to open for Tuggi's own side of the contract — a DIFFERENT row of
  // `core.clients` from the partner's, and the reason `target` carries an id at all.
  const ownerId = owner.id
  const missing: ChecklistItem[] = []

  const legalName = owner.company_name?.trim() || owner.name?.trim() || ''
  const taxId = owner.tax_id?.trim() ?? ''
  const addressLine = [owner.address, owner.city, owner.state, owner.postal_code]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ')
  const representativeName = owner.legal_representative_name?.trim() ?? ''
  const representativeRole = owner.legal_representative_role?.trim() ?? ''

  if (!legalName) {
    missing.push({ id: 'provider_legal_name', label: 'Razão social da Tuggi', where: OWNER_PROFILE_TAB, target: { kind: 'client', clientId: ownerId, tab: 'profile' } })
  }
  if (!taxId) {
    missing.push({ id: 'provider_tax_id', label: 'CNPJ da Tuggi', where: OWNER_FISCAL_TAB, target: { kind: 'client', clientId: ownerId, tab: 'fiscal' } })
  }
  // The address of the row is the required part; city, state and CEP only enrich the line.
  if (!owner.address?.trim()) {
    missing.push({ id: 'provider_address', label: 'Endereço da Tuggi', where: OWNER_PROFILE_TAB, target: { kind: 'client', clientId: ownerId, tab: 'profile' } })
  }
  if (!representativeName) {
    missing.push({
      id: 'provider_representative_name',
      label: 'Nome do representante legal da Tuggi',
      where: OWNER_FISCAL_TAB,
      target: { kind: 'client', clientId: ownerId, tab: 'fiscal' },
    })
  }
  if (!representativeRole) {
    missing.push({
      id: 'provider_representative_role',
      label: 'Cargo do representante legal da Tuggi',
      where: OWNER_FISCAL_TAB,
      target: { kind: 'client', clientId: ownerId, tab: 'fiscal' },
    })
  }

  if (missing.length > 0) return { party: null, missing }
  return {
    party: { legalName, taxId, addressLine, representativeName, representativeRole },
    missing: [],
  }
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

/**
 * WHERE the operator resolves one missing item, said twice on purpose — and they are not the
 * same statement.
 *
 * `where` is the sentence a person reads (`aba Fiscal e Pagamentos`), written by `design`.
 * `target` is the same fact in a shape a screen can act on, so the item becomes a control
 * instead of an instruction: while only the prose existed, generating a contract meant reading
 * the sentence, leaving for the client record, hunting for the tab, filling one field, coming
 * back, and discovering the next hole — one round trip per missing field, up to ten of them.
 *
 * They cannot drift because they are built side by side, in this module, from the same branch.
 * The screen renders the prose and acts on the target; the day a sixth field appears, both
 * halves of the answer are written in the same line of code.
 */
export type ChecklistTarget =
  /**
   * A field of somebody's registration. `clientId` is the record to open — THIS partner for
   * their own data, and the client marked as the platform owner for Tuggi's side of the
   * contract, which lives in a different record entirely. `null` when there is no record to
   * open (nobody is marked as owner yet, or more than one is).
   */
  | { kind: 'client'; clientId: string | null; tab: 'profile' | 'fiscal' }
  /** The in-person conference of the proposal — the evidence of BR-B2B-022, item 3. */
  | { kind: 'conference' }
  /** A field of the contract form itself, already on screen. */
  | { kind: 'page' }

/** One missing thing, where a person reads it is, and where a screen can take them. */
export interface ChecklistItem {
  id: string
  label: string
  where: string
  target: ChecklistTarget
}

/**
 * Where the evidence of BR-B2B-022, item 3, is registered — the band of the proposal's conference
 * screen, in the words the operator reads at the top of it (`PartnerProposals.conference.heading`).
 *
 * ONE CONSTANT because the four items below point at the same place, and a `where` that drifts on
 * one of them sends somebody to a screen that cannot answer. It is NOT the partner form: there has
 * been no upload there since 2026-08-16.
 */
const CONFERENCE_BAND = 'banda Conferência presencial, na proposta'

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
  options: { platformOwner: PlatformOwnerLookup; regularity: RegularityEvidence; now?: Date }
): ChecklistResult {
  const missing: ChecklistItem[] = []
  const now = options.now ?? new Date()

  // The Tuggi qualification is a checklist item like any other, and it names the field and
  // the tab — a contract generated without it would print an incomplete CONTRATADA.
  missing.push(...resolvePlatformOwner(options.platformOwner).missing)

  if (!client) {
    missing.push({ id: 'client', label: 'Cadastro do cliente não encontrado', where: 'lista de clientes', target: { kind: 'client', clientId: null, tab: 'profile' } })
    return { ready: false, missing }
  }

  if (!client.tax_id?.trim()) {
    missing.push({ id: 'tax_id', label: 'CNPJ do estabelecimento', where: 'aba Fiscal e Pagamentos', target: { kind: 'client', clientId: client.id, tab: 'fiscal' } })
  }

  if (!client.company_name?.trim() && !client.name?.trim()) {
    missing.push({ id: 'legal_name', label: 'Razão social do estabelecimento', where: 'aba Perfil', target: { kind: 'client', clientId: client.id, tab: 'profile' } })
  }

  if (!client.address?.trim()) {
    missing.push({ id: 'address', label: 'Endereço do estabelecimento', where: 'aba Perfil', target: { kind: 'client', clientId: client.id, tab: 'profile' } })
  }

  if (!client.legal_representative_name?.trim()) {
    missing.push({ id: 'representative_name', label: 'Nome do representante legal', where: 'aba Fiscal e Pagamentos', target: { kind: 'client', clientId: client.id, tab: 'fiscal' } })
  }

  if (!client.legal_representative_role?.trim()) {
    missing.push({ id: 'representative_role', label: 'Cargo do representante legal', where: 'aba Fiscal e Pagamentos', target: { kind: 'client', clientId: client.id, tab: 'fiscal' } })
  }

  // BR-B2B-022, item 3: "documento vencido é ausência".
  //
  // THE EVIDENCE IS A CONFERENCE, NOT AN UPLOAD, and the checklist says where it really is. The
  // partner form stopped asking for either file on 2026-08-16 — the papers are checked in person
  // before the link is ever sent — so `anexado` named an act that does not exist and
  // `formulário do parceiro` sent the operator to a screen with no field to fill. What
  // `loadRegularity` reads is the `ConferenceRecord` inside the review annotation, registered in
  // the `Conferência presencial` band of the proposal (`ProposalReview`, `conference.heading`).
  const regularity = options.regularity
  if (!regularity.businessLicenseDocument) {
    missing.push({ id: 'business_license', label: 'Alvará de funcionamento conferido', where: CONFERENCE_BAND, target: { kind: 'conference' } })
  } else if (!regularity.businessLicenseValidUntil) {
    missing.push({
      id: 'business_license_validity',
      label: 'Validade do alvará preenchida',
      where: CONFERENCE_BAND,
      target: { kind: 'conference' },
    })
  } else if (new Date(regularity.businessLicenseValidUntil).getTime() <= now.getTime()) {
    missing.push({
      id: 'business_license_expired',
      label: 'Alvará vencido — pedir o vigente ao parceiro',
      where: CONFERENCE_BAND,
      target: { kind: 'conference' },
    })
  }

  if (!regularity.incorporationDocument) {
    missing.push({ id: 'incorporation', label: 'Documento de constituição conferido', where: CONFERENCE_BAND, target: { kind: 'conference' } })
  }

  if (typeof client.commission_rate !== 'number') {
    missing.push({ id: 'commission_rate', label: 'Percentual de comissão', where: 'aba Fiscal e Pagamentos', target: { kind: 'client', clientId: client.id, tab: 'fiscal' } })
  }

  if (choices.qrDeliveryDays === null || !Number.isInteger(choices.qrDeliveryDays) || choices.qrDeliveryDays <= 0) {
    missing.push({ id: 'qr_delivery', label: 'Prazo de entrega do QR e do display, em dias', where: 'esta página', target: { kind: 'page' } })
  }

  if (choices.tier === 'paid') {
    if (!choices.paymentMethod) {
      missing.push({ id: 'payment_method', label: 'Forma de pagamento (boleto ou Pix)', where: 'esta página', target: { kind: 'page' } })
    }

    // Absent is incomplete registration; zero without the courtesy decision is the same
    // thing wearing a number. Only the marked courtesy, with a reason, is a decision.
    const courtesy = client.is_courtesy === true
    const fee = client.monthly_fee_cents

    if (courtesy) {
      if (!client.courtesy_reason?.trim()) {
        missing.push({ id: 'courtesy_reason', label: 'Motivo da cortesia', where: 'aba Fiscal e Pagamentos', target: { kind: 'client', clientId: client.id, tab: 'fiscal' } })
      }
    } else if (typeof fee !== 'number' || !Number.isFinite(fee) || fee <= 0) {
      missing.push({
        id: 'monthly_fee',
        label:
          typeof fee === 'number' && fee === 0
            ? 'Valor mensal: zero digitado não vale como cortesia — marque "Cortesia (sem mensalidade)" com o motivo'
            : 'Valor mensal do contrato',
        where: 'aba Fiscal e Pagamentos',
        target: { kind: 'client', clientId: client.id, tab: 'fiscal' },
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
  options: { platformOwner: PlatformOwnerLookup; regularity: RegularityEvidence; templateVersion: string; now?: Date }
): ContractSnapshot {
  const check = contractChecklist(client, choices, {
    platformOwner: options.platformOwner,
    regularity: options.regularity,
    now: options.now,
  })
  if (!check.ready) {
    throw new Error(`contract snapshot refused: ${check.missing.map((item) => item.id).join(', ')}`)
  }

  // `ready` already proved the five are there; this is the copy, and copying is what
  // freezes them (BR-B2B-017, item 5). Editing the owner registration afterwards is the
  // value of the NEXT contract.
  const provider = resolvePlatformOwner(options.platformOwner).party as ProviderParty
  const courtesy = client.is_courtesy === true

  return {
    templateVersion: options.templateVersion,
    tier: choices.tier,
    provider,
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
