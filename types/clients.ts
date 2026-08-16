/**
 * Types for the Clients feature
 */

export type ClientStatus = 'pending' | 'approved' | 'rejected'
export type ClientRole = 'owner' | 'manager' | 'viewer'

/**
 * Relationship category — the SINGLE vocabulary of `core.clients.client_type`.
 *
 * THIS LIST IS THE MIRROR OF `clients_client_type_check`, and the database is the owner.
 * Measured on the live constraint on 2026-08-16, after `20260816150000`:
 *
 *   CHECK (client_type = ANY (ARRAY['business','influencer','hotel','partner','creator',
 *                                   'driver','venue']))
 *
 * The order is the constraint's, so a `diff` against the next measurement reads straight.
 *
 * Two of them are here because leaving them out was a lie the screens told in silence:
 *  · `driver`  — the app writes it through `drive.register_partner_v1`, and the app has no
 *                OTA: a type that refuses the value the published app already stores is the
 *                type that is wrong, not the data;
 *  · `venue`   — the merchant with an address, BR-B2B-020 item 5. Declared by the operator on
 *                2026-08-14 (*"será tipo locais"*); the identifier is English by CLAUDE.md §6.
 *
 * Adding a value here without the migration that widens the CHECK produces a row the database
 * refuses at write time. The two go together, in this order: migration first.
 */
export const CLIENT_TYPES = [
  'business',
  'influencer',
  'hotel',
  'partner',
  'creator',
  'driver',
  'venue',
] as const

export type ClientType = (typeof CLIENT_TYPES)[number]

/**
 * What a client with no declared type is. `core.clients.client_type` is NOT NULL with
 * DEFAULT `'business'`, and this constant is the ONE place the CMS repeats it.
 *
 * It used to be typed out at four call sites — two POST routes and two modals — which is the
 * same decision declared four times (CLAUDE.md §6, SSOT). Whoever changes the column's default
 * changes this line, and the four call sites follow without being found again.
 */
export const DEFAULT_CLIENT_TYPE: ClientType = 'business'

/**
 * Whether a value coming from outside is one of the seven.
 *
 * The two POST routes hold `service_role`, which ignores RLS — the route is the only barrier
 * left, and without this the CHECK answers for it with a 500 that names a constraint instead
 * of a 400 that names the field.
 */
export function isClientType(value: unknown): value is ClientType {
  return typeof value === 'string' && (CLIENT_TYPES as readonly string[]).includes(value)
}

/**
 * Client entity - represents a business/organization client
 */
export interface Client {
  id: string
  name: string
  email: string
  phone?: string
  company_name?: string
  address?: string
  city?: string
  state?: string
  country?: string
  postal_code?: string
  industry?: string
  website?: string
  status: ClientStatus
  rejection_reason?: string
  approved_by?: string
  cms_user_id?: string
  created_at: string
  updated_at: string
  approved_at?: string
  metadata?: Record<string, any>
  notes?: string
  // URL-friendly identifier for the public /d/<slug> download page
  slug?: string
  // Legal & Fiscal
  tax_id?: string
  tax_id_type?: TaxIdType
  legal_representative_name?: string
  legal_representative_role?: string
  // Banking
  billing_email?: string
  iban?: string
  bic_swift?: string
  bank_account_number?: string
  bank_routing_number?: string
  bank_name?: string
  // Commission
  commission_rate?: number
  /**
   * The monthly fee of the paid tier, in cents (BR-B2B-017, item 4). It is the value for
   * the NEXT contract or amendment — a signed contract carries its own frozen value and
   * does not follow this field (item 5).
   *
   * `null`/absent is an incomplete registration, and it is NOT zero: a partner with no fee
   * is a decision that has to be recorded as `is_courtesy` with a reason (item 6).
   */
  monthly_fee_cents?: number | null
  is_courtesy?: boolean | null
  courtesy_reason?: string | null
  is_platform_owner?: boolean
  welcome_poi_id?: string
  // Partner / consumer-facing attribution (20260528125114_clients_supports_partners)
  client_type?: ClientType
  avatar_url?: string
  social_handle?: string
  bio_one_line?: string
  // Afiliados (20260717_06_client_hierarchy): coordenador gerencia empresas-filhas.
  is_coordinator?: boolean
  parent_client_id?: string | null
}

export type TaxIdType = 'cnpj' | 'nipc' | 'nif' | 'vat' | 'ein' | 'other'

/**
 * Link between a Client and a CMS User
 */
export interface ClientCmsUser {
  id: string
  client_id: string
  cms_user_id: string
  client_role: ClientRole
  created_at: string
  linked_by?: string
}

/**
 * Extended Client with related data
 */
export interface ClientWithUsers extends Client {
  cms_users?: ClientCmsUser[]
  pois_count?: number
}

/**
 * Request/Response DTOs
 */

export interface RegisterClientRequest {
  name: string
  full_name?: string
  email: string
  phone?: string
  company_name?: string
  address?: string
  city?: string
  state?: string
  country?: string
  postal_code?: string
  industry?: string
  website?: string
}

export interface ApproveClientRequest {
  clientId: string
  cmsUserEmail: string
  cmsUserName: string
}

export interface LinkCmsUserRequest {
  clientId: string
  cmsUserId: string
  clientRole?: ClientRole
}



/**
 * UI Component Props
 */

export interface ClientRegistrationFormProps {
  onSuccess?: (clientId: string) => void
  onError?: (error: string) => void
}

export interface ClientApprovalPanelProps {
  onApprove?: (clientId: string) => void
  onReject?: (clientId: string) => void
}

export interface ClientDashboardProps {
  clientId?: string
}
