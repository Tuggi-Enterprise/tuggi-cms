/**
 * O seletor de push direto (`components/marketing/notifications/NotificationManager`)
 * carregava 50 perfis ordenados por `last_sign_in_at` e filtrava esse array no
 * cliente. Quem estivesse fora dessa janela — `AdventurerCurious2772` era o 119º —
 * não aparecia por busca nenhuma: o termo nunca chegava ao banco.
 *
 * O teste afirma na rede, não na chamada: um servidor HTTP local faz as vezes do
 * PostgREST e registra a query. `searchProfiles` tem de mandar o termo como filtro
 * `or=(nickname.ilike…,full_name.ilike…)`, com `limit`, e sem termo tem de cair no
 * mesmo comportamento de antes (a janela recente, sem filtro).
 *
 * Run with: npm run test:api
 */

import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

interface RecordedRequest {
  path: string
  params: URLSearchParams
  acceptProfile?: string
}

let server: Server
let baseUrl: string
let client: SupabaseClient
let requests: RecordedRequest[] = []
let dashboardService: any

const ROW = {
  id: '4f19097d-088a-4cb8-90f3-965ff2afb23d',
  nickname: 'AdventurerCurious2772',
  full_name: 'Elena Parravicini',
}

function startFakePostgrest(): Promise<void> {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    requests.push({
      path: url.pathname,
      params: url.searchParams,
      acceptProfile: req.headers['accept-profile'] as string | undefined,
    })
    res.setHeader('Content-Type', 'application/json')
    res.statusCode = 200
    res.end(JSON.stringify([ROW]))
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
      resolve()
    })
  })
}

before(async () => {
  await startFakePostgrest()

  client = createClient(baseUrl, 'test-publishable-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const { mock } = await import('node:test')
  mock.module('@/lib/core/supabase-client', {
    namedExports: { getSupabaseClient: () => client },
  })

  dashboardService = (await import('@/lib/services/dashboard-service')).dashboardService
})

after(() => server.close())

beforeEach(() => {
  requests = []
})

function onlyRequest(): RecordedRequest {
  assert.equal(requests.length, 1, 'expected exactly one PostgREST request')
  return requests[0]
}

test('searchProfiles manda o termo ao banco, em nickname e full_name', async () => {
  const result = await dashboardService.searchProfiles('AdventurerCurious2772', 50)

  const request = onlyRequest()
  assert.equal(request.path, '/rest/v1/profiles')
  assert.equal(request.acceptProfile, 'drive')

  const or = request.params.get('or')
  assert.ok(or, 'a busca precisa virar filtro na query, não filtro no cliente')
  assert.ok(or!.includes('nickname.ilike.%AdventurerCurious2772%'), or!)
  assert.ok(or!.includes('full_name.ilike.%AdventurerCurious2772%'), or!)
  assert.equal(request.params.get('limit'), '50')

  assert.equal(result.success, true)
  assert.equal(result.data[0].nickname, ROW.nickname)
})

test('busca vazia mantém a janela de logins recentes, sem filtro', async () => {
  await dashboardService.searchProfiles('   ', 50)

  const request = onlyRequest()
  assert.equal(request.path, '/rest/v1/profiles')
  assert.equal(request.params.get('or'), null, 'sem termo não há filtro a aplicar')
  assert.equal(request.params.get('order'), 'last_sign_in_at.desc.nullslast')
})

// Controle anti-vacuidade: um caractere de wildcard no termo não pode virar
// wildcard no filtro, senão a busca por `100%` casa com a base inteira.
test('% e _ do termo são escapados', async () => {
  await dashboardService.searchProfiles('100%_x', 50)

  const or = onlyRequest().params.get('or')!
  assert.ok(or.includes('100\\%\\_x'), or)
})
