/**
 * #1139 — rows of `drive.list_partner_requests_as()` as the RPC answers them (snake case), and the
 * same rows parsed. Invented people; the CPFs and the CNPJ pass the check digits.
 */

import { parsePartnerRequestRows, type PartnerRequestRow } from '@/lib/partner-requests/queue'

export const RPC_ROWS = [
  {
    request_id: 12,
    user_id: '11111111-1111-4111-8111-111111111111',
    nickname: 'ana.souza',
    display_name: 'Ana',
    partner_type: 'creator',
    document_type: 'cpf',
    document: '52998224725',
    full_name: 'Ana Souza',
    legal_name: null,
    representative_cpf: null,
    whatsapp: '5524999998888',
    contact_email: 'ana@example.com',
    publishes_at: '@ana.souza',
    region: 'Paraty',
    accepted_at: '2026-11-08T14:32:00.000+00:00',
    acceptance_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    terms_version: 'parceiros-sem-local-2026-11-v2',
    document_in_use: false,
    existing_client_id: '33333333-3333-4333-8333-333333333333',
  },
  {
    request_id: 13,
    user_id: '22222222-2222-4222-8222-222222222222',
    nickname: 'viaja.rio',
    display_name: null,
    partner_type: 'influencer',
    document_type: 'cnpj',
    document: '11222333000181',
    full_name: 'Bruno Lima',
    legal_name: 'Viaja Rio Conteúdo LTDA',
    representative_cpf: '11144477735',
    whatsapp: '5521988887777',
    contact_email: 'contato@viajario.com.br',
    publishes_at: 'https://www.instagram.com/viaja.rio',
    region: 'Rio de Janeiro',
    accepted_at: '2026-11-08T16:05:00.000+00:00',
    acceptance_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    terms_version: 'parceiros-sem-local-2026-11-v2',
    document_in_use: true,
    existing_client_id: null,
  },
  {
    request_id: 14,
    user_id: '44444444-4444-4444-8444-444444444444',
    nickname: 'ze.transfer',
    display_name: 'Zé',
    partner_type: 'driver',
    document_type: 'cpf',
    document: '39053344705',
    full_name: 'José Pereira',
    legal_name: null,
    representative_cpf: null,
    whatsapp: '22999997777',
    contact_email: 'ze@example.com',
    publishes_at: null,
    region: 'Búzios',
    accepted_at: '2026-11-09T09:10:00.000+00:00',
    acceptance_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    terms_version: 'parceiros-sem-local-2026-11-v2',
    document_in_use: false,
    existing_client_id: null,
  },
]

export const REQUESTS: PartnerRequestRow[] = parsePartnerRequestRows(RPC_ROWS) ?? []
