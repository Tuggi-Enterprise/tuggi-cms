/**
 * The partners that can have a message (#1264, BR-COMUNICACAO-026 item 4.a; contract
 * `docs/contracts/tuggi-do-parceiro.md` §11.2): `partner.cms_partner_message_senders`.
 *
 * `GET` → `{ senders: PartnerMessageSender[] }`: @, name, whether they can send now, how many have the
 * yes now, the monthly cap read from the configuration and how much of the month is used.
 *
 * `withAuth({ roles: ['admin'] })`, then the service role.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { listSenders } from '@/lib/services/partner-message-service'
import { partnerMessageErrorStatus } from '@/lib/partner-message/message'

export const GET = withAuth({ roles: ['admin'] }, async () => {
  const read = await listSenders(getSupabaseService())
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: partnerMessageErrorStatus(read.error) })
  return NextResponse.json({ senders: read.value }, { headers: { 'Cache-Control': 'no-store' } })
})
