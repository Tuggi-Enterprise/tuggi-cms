/**
 * `GET /api/dashboard/push/people?send_key=&opened=true|false&page=N`: one page of the people of a
 * send (BR-COMUNICACAO-019 3.m.9, #1051), from `drive.cms_get_push_send_people`.
 *
 * PERSONAL DATA. Admin by `withAuth`, then service_role. What leaves is the user id, the
 * nickname (BR-USUARIO-042: never the e-mail) and the three times, nothing else; `total_count`
 * is moved out of the rows. Broadcast has no list (spec 1.4) and is refused before the database.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  PUSH_PEOPLE_PAGE_SIZE,
  isPeopleSendKey,
  pushPeoplePage,
  type PushPeoplePage,
  type PushPerson,
} from '@/lib/notifications/push-report'
import { pushRpcFailure } from '@/lib/notifications/push-report-route'

export const dynamic = 'force-dynamic'

interface PeopleRow extends PushPerson {
  total_count: number
}

export const GET = withAuth({ roles: ['admin'] }, async (req: NextRequest) => {
  const params = new URL(req.url).searchParams
  const sendKey = params.get('send_key')
  const opened = params.get('opened')
  const page = pushPeoplePage(params.get('page'))
  if (!isPeopleSendKey(sendKey) || (opened !== 'true' && opened !== 'false') || page === null) {
    return NextResponse.json({ error: 'send_key (weekly or direct), opened true|false and page >= 0 are required', code: '22023' }, { status: 400 })
  }

  const { data, error } = await getSupabaseService()
    .schema('drive')
    .rpc('cms_get_push_send_people', {
      p_send_key: sendKey,
      p_opened: opened === 'true',
      p_limit: PUSH_PEOPLE_PAGE_SIZE,
      p_offset: page * PUSH_PEOPLE_PAGE_SIZE,
    })
  if (error) return pushRpcFailure('people', error)

  const rows = (data ?? []) as PeopleRow[]
  const body: PushPeoplePage = {
    people: rows.map((row) => ({
      user_id: row.user_id,
      nickname: row.nickname,
      sent_at: row.sent_at,
      delivered_at: row.delivered_at,
      read_at: row.read_at,
    })),
    total: rows[0]?.total_count ?? 0,
  }
  return NextResponse.json({ data: body })
})
