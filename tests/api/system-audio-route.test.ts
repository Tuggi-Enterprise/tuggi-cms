/**
 * `/api/system-audio` — a porta do CMS para a Edge Function `generate-system-audio`.
 *
 * O que esta rota tem para provar é curto e é tudo sobre confiança:
 *
 * - **quem entra**: gerar áudio escreve num bucket público, então só `admin`;
 * - **com que credencial**: a EF exige Bearer JWT, e a `SUPABASE_SECRET_KEY` no
 *   formato `sb_secret_...` NÃO é JWT — a rota tem que repassar o `access_token` da
 *   sessão do operador. Já foi defeito uma vez, documentado em
 *   `app/api/routes/[id]/translations/generate/route.ts`;
 * - **sem catálogo próprio**: a rota não redeclara chave, locale nem parser. Ela
 *   repassa. Uma segunda lista aqui seria a que envelhece calada.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'

interface ForwardedCall {
  url: string
  method: string
  authorization: string | null
  body: unknown
}

interface Scenario {
  role: string
  accessToken: string | null
  forwarded: ForwardedCall[]
  functionStatus: number
  functionPayload: unknown
}

const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.operator.signature'

let scenario: Scenario

function freshScenario(): Scenario {
  return {
    role: 'admin',
    accessToken: ACCESS_TOKEN,
    forwarded: [],
    functionStatus: 200,
    functionPayload: { catalogue: {}, files: [] },
  }
}

function createClient() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: 'auth-operator-1', email: 'admin@tuggi.app' } },
        error: null,
      }),
      getSession: async () => ({
        data: {
          session: scenario.accessToken ? { access_token: scenario.accessToken } : null,
        },
        error: null,
      }),
    },
    schema: () => ({
      from: () => {
        const query: any = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({
            data: { email: 'admin@tuggi.app', role: scenario.role, is_active: true },
            error: null,
          }),
        }
        return query
      },
    }),
  }
}

let route: typeof import('@/app/api/system-audio/route')

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'

  mock.module('next/headers', {
    namedExports: { cookies: async () => ({ get: () => undefined, getAll: () => [] }) },
  })
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabaseRouteHandler: () => createClient(),
      getSupabaseService: () => createClient(),
      getSupabase: () => createClient(),
    },
  })

  globalThis.fetch = (async (input: any, init: any = {}) => {
    scenario.forwarded.push({
      url: String(input),
      method: init.method,
      authorization: init.headers?.Authorization ?? null,
      body: init.body ? JSON.parse(init.body) : undefined,
    })
    return new Response(JSON.stringify(scenario.functionPayload), {
      status: scenario.functionStatus,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  route = await import('@/app/api/system-audio/route')
})

beforeEach(() => {
  scenario = freshScenario()
})

const request = (method: string, body?: unknown): NextRequest =>
  new Request('http://localhost/api/system-audio', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as unknown as NextRequest

const GENERATE = {
  family: 'notice',
  key: 'offline',
  locale: 'pt-br',
  gender: 'male',
  tier: 'hd',
}

test('o inventário chega pela EF, com o JWT do operador', async () => {
  const response = await route.GET(request('GET'))

  assert.equal(response.status, 200)
  assert.equal(scenario.forwarded.length, 1)
  assert.equal(
    scenario.forwarded[0].url,
    'https://project.supabase.co/functions/v1/generate-system-audio'
  )
  assert.equal(scenario.forwarded[0].method, 'GET')
  assert.equal(scenario.forwarded[0].authorization, `Bearer ${ACCESS_TOKEN}`)
})

test('gerar repassa o corpo inteiro, sem reescrever o pedido do operador', async () => {
  scenario.functionPayload = { path: 'notice-audios/offline_pt-br_male.mp3' }

  const response = await route.POST(request('POST', GENERATE))

  assert.equal(response.status, 200)
  assert.equal(scenario.forwarded[0].method, 'POST')
  assert.deepEqual(scenario.forwarded[0].body, GENERATE)
})

test('apagar repassa o caminho — quem valida a forma é a EF, dona do parser', async () => {
  scenario.functionPayload = { deleted: 'notice-audios/offline_pt-br_male.mp3' }

  const response = await route.DELETE(
    request('DELETE', { path: 'notice-audios/offline_pt-br_male.mp3' })
  )

  assert.equal(response.status, 200)
  assert.equal(scenario.forwarded[0].method, 'DELETE')
  assert.deepEqual(scenario.forwarded[0].body, { path: 'notice-audios/offline_pt-br_male.mp3' })
})

test('papel que não é admin não chega à EF', async () => {
  for (const role of ['editor', 'viewer', 'client']) {
    scenario = freshScenario()
    scenario.role = role

    const generate = await route.POST(request('POST', GENERATE))
    const remove = await route.DELETE(request('DELETE', { path: 'notice-audios/x_pt-br_male.mp3' }))
    const list = await route.GET(request('GET'))

    assert.equal(generate.status, 403, `${role} conseguiu gerar`)
    assert.equal(remove.status, 403, `${role} conseguiu apagar`)
    assert.equal(list.status, 403, `${role} conseguiu listar`)
    assert.deepEqual(scenario.forwarded, [], `${role} chegou à Edge Function`)
  }
})

test('sessão sem access_token não vira chamada anônima à EF', async () => {
  scenario.accessToken = null

  const response = await route.POST(request('POST', GENERATE))

  assert.equal(response.status, 401)
  assert.deepEqual(scenario.forwarded, [])
})

test('erro da EF chega ao operador com o status e a mensagem originais', async () => {
  scenario.functionStatus = 422
  scenario.functionPayload = { error: 'Key "passactive" has no copy yet' }

  const response = await route.POST(request('POST', { ...GENERATE, key: 'passactive' }))

  assert.equal(response.status, 422)
  assert.equal((await response.json()).error, 'Key "passactive" has no copy yet')
})
