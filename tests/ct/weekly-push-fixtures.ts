/** Sample answers of the weekly push API for the CT suite (#1047). Shapes of docs/contracts/banco-para-cms.md part 20. */

const LANGUAGES = ['pt', 'en', 'es', 'fr', 'it']
const SEED: Record<string, [string, string]> = {
  'thursday_local/event': ['Evento perto de você', '{name}, {city}. Acontece nos próximos dias, e dá tempo de se programar.'],
  'thursday_local/reminder_city': ['{city} no fim de semana', 'Dê uma volta pela cidade com o Tuggi. Ele mostra o que tem ao redor.'],
  'thursday_local/reminder_no_city': ['Fim de semana chegando', 'Dê uma volta com o Tuggi. Ele mostra o que tem ao redor e conta a história dos lugares.'],
  'saturday_local/route': ['Rota com histórias perto de você', '{name}, {city}. Histórias pelo caminho, e dá para fazer hoje.'],
  'saturday_local/reminder_city': ['Sábado em {city}', 'Saia hoje com o Tuggi ligado e ouça a história do que passa pela janela.'],
  'saturday_local/reminder_no_city': ['Sábado para sair', 'Saia hoje com o Tuggi ligado e ouça a história do que passa pela janela.'],
}

export const SETTINGS = {
  pieces: [
    { piece: 'thursday_local', push_kind: 'weekly_thursday_local', local_dow: 4, local_hour: 18, is_active: true, updated_at: null, last_sent_local_date: '2026-10-23' },
    { piece: 'saturday_local', push_kind: 'weekly_saturday_local', local_dow: 6, local_hour: 10, is_active: false, updated_at: '2026-10-27T14:00:00Z', last_sent_local_date: '2026-10-25' },
  ],
  texts: Object.entries(SEED).flatMap(([key, [title, body]]) => {
    const [piece, variant] = key.split('/')
    return LANGUAGES.map((language) => ({ piece, variant, language, title, body, updated_at: null }))
  }),
  policy: { week_cap: 2, quiet_from_hour: 22, quiet_until_hour: 8, allowed_hours: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21] },
  last_changed_at: '2026-10-27T14:00:00Z',
}

const send = (piece: string, local_date: string, sent: number, denied: number, not_delivered: number, failed: number, claimed = 0) => ({
  piece, local_date, picked: sent + denied + not_delivered + failed + claimed, claimed, sent, denied, not_delivered, failed,
})

export const RESULTS = {
  weeks: [
    { week_start: '2026-10-20', sent_people: 1180, push_off_today: 14, sends: [send('saturday_local', '2026-10-25', 512, 31, 4, 0), send('thursday_local', '2026-10-23', 702, 0, 6, 1)] },
    { week_start: '2026-10-13', sent_people: 1102, push_off_today: 9, sends: [send('saturday_local', '2026-10-18', 488, 26, 0, 0), send('thursday_local', '2026-10-16', 655, 0, 3, 0)] },
  ],
}
