/**
 * The partner message in the CMS (#1264, BR-COMUNICACAO-026 items 6.a, 6.b and 6.e). Contract
 * `docs/contracts/tuggi-do-parceiro.md` §11.2. Server only: every function runs on the service role,
 * after the route's `withAuth`, with the session's auth user as `p_actor` (the curator, a FOREIGN KEY
 * to `auth.users`). Every write answers the message as `partner.cms_get_partner_message` does.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  classifyPartnerMessageError,
  type DecisionInput,
  type PartnerMessage,
  type PartnerMessageError,
  type PartnerMessageRow,
  type PartnerMessageSender,
  type PartnerMessageStatus,
  type SaveInput,
} from '@/lib/partner-message/message'

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: PartnerMessageError }

const partner = (db: SupabaseClient) => db.schema('partner')

export async function listSenders(db: SupabaseClient): Promise<Outcome<PartnerMessageSender[]>> {
  const { data, error } = await partner(db).rpc('cms_partner_message_senders')
  if (error) return { ok: false, error: classifyPartnerMessageError(error, 'read_failed') }
  return { ok: true, value: (data ?? []) as PartnerMessageSender[] }
}

export async function listMessages(
  db: SupabaseClient,
  filter: { clientId: string | null; status: PartnerMessageStatus | null }
): Promise<Outcome<PartnerMessageRow[]>> {
  const { data, error } = await partner(db).rpc('cms_list_partner_messages', {
    p_client_id: filter.clientId,
    p_status: filter.status,
    p_limit: 200,
    p_offset: 0,
  })
  if (error) return { ok: false, error: classifyPartnerMessageError(error, 'read_failed') }
  return { ok: true, value: (data ?? []) as PartnerMessageRow[] }
}

export async function getMessage(db: SupabaseClient, id: string): Promise<Outcome<PartnerMessage>> {
  const { data, error } = await partner(db).rpc('cms_get_partner_message', { p_message_id: id })
  if (error) return { ok: false, error: classifyPartnerMessageError(error, 'read_failed') }
  if (!data) return { ok: false, error: { code: 'not_found' } }
  return { ok: true, value: data as PartnerMessage }
}

/** Create (`messageId` null) or edit a draft; the texts are replaced at once. */
export async function saveMessage(
  db: SupabaseClient,
  messageId: string | null,
  input: SaveInput,
  actor: string
): Promise<Outcome<PartnerMessage>> {
  const { data, error } = await partner(db).rpc('cms_save_partner_message', {
    p_message_id: messageId,
    p_client_id: input.client_id,
    p_requested_by: input.requested_by,
    p_requested_at: input.requested_at,
    p_button_kind: input.button_kind,
    p_button_ref: input.button_ref,
    p_image_path: input.image_path,
    p_texts: input.texts,
    p_actor: actor,
  })
  if (error) return { ok: false, error: classifyPartnerMessageError(error) }
  return { ok: true, value: data as PartnerMessage }
}

/** One act of the curator. The database checks the state, the window and the caps. */
export async function decideMessage(
  db: SupabaseClient,
  id: string,
  decision: DecisionInput,
  actor: string
): Promise<Outcome<PartnerMessage>> {
  const call = () => {
    switch (decision.action) {
      case 'approve':
        return partner(db).rpc('cms_approve_partner_message', { p_message_id: id, p_actor: actor })
      case 'refuse':
        return partner(db).rpc('cms_refuse_partner_message', { p_message_id: id, p_reason: decision.reason, p_actor: actor })
      case 'schedule':
        return partner(db).rpc('cms_schedule_partner_message', {
          p_message_id: id,
          p_local_send_at: decision.local_send_at,
          p_actor: actor,
        })
      case 'unschedule':
        return partner(db).rpc('cms_unschedule_partner_message', { p_message_id: id, p_actor: actor })
      case 'cancel':
        return partner(db).rpc('cms_cancel_partner_message', { p_message_id: id, p_reason: decision.reason, p_actor: actor })
    }
  }
  const { data, error } = await call()
  if (error) return { ok: false, error: classifyPartnerMessageError(error) }
  return { ok: true, value: data as PartnerMessage }
}
