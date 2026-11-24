/**
 * Replies of the `/api/admin/trip-reminder/*` routes for the #1233 component tests, in the shape
 * of `docs/contracts/viagem-marcada-e-lembrete.md`. Seeds of the 120000 migration for switches and
 * slots, of the 210000 (#1237) for the numbers; panel and sends are invented counts, never a person.
 */

export const SETTINGS = {
  switches: [
    { key: 'entry.requires_account', is_on: false, channel_kind: null, channel_order: null, rule_id: 'BR-USUARIO-054', updated_at: null },
    { key: 'phone.ask', is_on: false, channel_kind: null, channel_order: null, rule_id: 'BR-COMUNICACAO-024', updated_at: null },
    { key: 'phone.confirmation', is_on: true, channel_kind: null, channel_order: null, rule_id: 'BR-COMUNICACAO-024', updated_at: null },
    { key: 'trip_reminder.enabled', is_on: true, channel_kind: null, channel_order: null, rule_id: 'BR-COMUNICACAO-023', updated_at: null },
    { key: 'trip_reminder.same_day', is_on: true, channel_kind: null, channel_order: null, rule_id: 'BR-COMUNICACAO-023', updated_at: null },
    { key: 'channel.push', is_on: true, channel_kind: 'device', channel_order: 1, rule_id: 'BR-COMUNICACAO-023', updated_at: null },
    { key: 'channel.email', is_on: true, channel_kind: 'email', channel_order: 2, rule_id: 'BR-COMUNICACAO-023', updated_at: null },
    { key: 'channel.whatsapp', is_on: false, channel_kind: 'phone', channel_order: 3, rule_id: 'BR-COMUNICACAO-024', updated_at: null },
    { key: 'channel.sms', is_on: false, channel_kind: 'phone', channel_order: 4, rule_id: 'BR-COMUNICACAO-024', updated_at: null },
  ],
  numbers: {
    'planned_trip.interval_months': { value: 0, unit: 'months', rule_id: 'BR-MONETIZACAO-091', updated_at: '2026-11-23T21:00:00Z' },
    'planned_trip.lead_days': { value: 3, unit: 'days', rule_id: 'BR-MONETIZACAO-091', updated_at: '2026-11-23T21:00:00Z' },
    'planned_trip.minutes_long': { value: 180, unit: 'minutes', rule_id: 'BR-MONETIZACAO-091', updated_at: '2026-11-23T21:00:00Z' },
    'planned_trip.minutes_short': { value: 60, unit: 'minutes', rule_id: 'BR-MONETIZACAO-091', updated_at: '2026-11-23T21:00:00Z' },
    'planned_trip.minutes_week': { value: 120, unit: 'minutes', rule_id: 'BR-MONETIZACAO-091', updated_at: '2026-11-23T21:00:00Z' },
    'planned_trip.validity_days': { value: 60, unit: 'days', rule_id: 'BR-MONETIZACAO-086', updated_at: '2026-11-23T15:00:00Z' },
    'welcome.minutes': { value: 60, unit: 'minutes', rule_id: 'BR-MONETIZACAO-058', updated_at: '2026-10-01T12:00:00Z' },
    'welcome.validity_days': { value: 5, unit: 'days', rule_id: 'BR-MONETIZACAO-086', updated_at: '2026-11-23T15:00:00Z' },
  },
  ask_phone_effective: false,
  templates: [
    { channel: 'whatsapp', piece: 'trip_reminder_before', language: 'pt', template_name: 'tuggi_lembrete_antes_v1', provider_language: 'pt_BR', updated_at: '2026-11-23T16:40:00Z' },
    { channel: 'whatsapp', piece: 'trip_reminder_day', language: 'en', template_name: 'tuggi_trip_day_v1', provider_language: 'en_US', updated_at: '2026-11-23T16:41:00Z' },
  ],
  secrets: [
    { name: 'email.api_key', channel: 'email', description: 'E-mail provider API key.', configured_at: '2026-11-23T17:02:00Z', last4: 'a91F' },
    { name: 'email.webhook_secret', channel: 'email', description: 'E-mail provider webhook signing secret.', configured_at: null, last4: null },
    { name: 'sms.account_id', channel: 'sms', description: 'SMS provider account id.', configured_at: null, last4: null },
    { name: 'sms.auth_token', channel: 'sms', description: 'SMS provider auth token or API secret.', configured_at: null, last4: null },
    { name: 'sms.sender', channel: 'sms', description: 'SMS sender: number or messaging service id.', configured_at: null, last4: null },
    { name: 'whatsapp.access_token', channel: 'whatsapp', description: 'WhatsApp Cloud API access token.', configured_at: null, last4: null },
    { name: 'whatsapp.app_secret', channel: 'whatsapp', description: 'Meta app secret, to check the signature of the webhook.', configured_at: null, last4: null },
    { name: 'whatsapp.phone_number_id', channel: 'whatsapp', description: 'WhatsApp Cloud API phone number id of the sender.', configured_at: '2026-11-23T17:05:00Z', last4: null },
    { name: 'whatsapp.webhook_verify_token', channel: 'whatsapp', description: 'Token of the webhook verification request.', configured_at: null, last4: null },
  ],
  secret_changes: [
    { name: 'whatsapp.phone_number_id', changed_at: '2026-11-23T17:05:00Z', changed_by: 'u1', changed_by_email: 'operador@tuggi.app' },
    { name: 'email.api_key', changed_at: '2026-11-23T17:02:00Z', changed_by: 'u1', changed_by_email: 'operador@tuggi.app' },
  ],
}

export const PANEL = {
  by_destination_month: [
    { country_code: 'BR', city: 'Búzios', month: '2026-12-01', duration_band: 'short', trips: 9 },
    { country_code: 'BR', city: 'Búzios', month: '2026-12-01', duration_band: 'week', trips: 5 },
    { country_code: 'PT', city: 'Lisboa', month: '2026-12-01', duration_band: 'long', trips: 6 },
    { country_code: 'BR', city: 'Paraty', month: '2027-01-01', duration_band: null, trips: 9 },
    { country_code: 'FR', city: null, month: '2027-02-01', duration_band: 'long', trips: 2 },
    { country_code: null, city: null, month: '2027-03-01', duration_band: 'week', trips: 4 },
    { country_code: 'BR', city: 'Ouro Preto', month: null, duration_band: 'short', trips: 3 },
  ],
  totals: {
    trips: 38,
    with_date: 35,
    with_destination: 34,
    accounts: 31,
    trip_hours_credited: 5,
    by_duration_band: { short: 12, week: 9, long: 8, none: 9 },
  },
  answers: { now: 12, planned: 38, unsure: 21 },
  contacts_by_channel: [{ channel: null, delivery_state: 'pending', stopped: false, contacts: 3 }],
  email_reminders_stopped: 1,
}

export const SENDS = [
  { id: 's3', created_at: '2026-11-23T18:10:00Z', updated_at: '2026-11-23T18:10:02Z', piece: 'test', channel: 'whatsapp', outcome: 'failed', reason: '131026', phone_last4: '4321' },
  { id: 's2', created_at: '2026-11-23T18:09:00Z', updated_at: '2026-11-23T18:09:01Z', piece: 'test', channel: 'email', outcome: 'delivered', reason: null, phone_last4: null },
  { id: 's1', created_at: '2026-11-23T13:00:00Z', updated_at: '2026-11-23T13:00:01Z', piece: 'trip_reminder_before', channel: 'push', outcome: 'sent', reason: null, phone_last4: null },
]
