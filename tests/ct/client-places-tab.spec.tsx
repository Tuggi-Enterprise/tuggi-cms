/**
 * #685 — a aba `Locais` da ficha do cliente aceita o SEGUNDO local.
 *
 * BR-B2B-033, item 3: um cliente tem N locais, e a cardinalidade é declaração do operador —
 * *"nenhum agente reverte isto para 1 : 1, nem para simplificar tela"*. O banco nunca reverteu
 * (`core.attractions.partner_client_id` é coluna do POI) e a rota também não (`verdictFor` só
 * recusa o local de OUTRO cliente, `other_owner`); quem revertia era a renderização, com o
 * `PlaceLinkPanel` dentro do bloco `places.length === 0`. Com um local vinculado, sumia a única
 * porta para o segundo.
 *
 * POR QUE AQUI E NÃO EM `tests/api`. `tests/api/client-places-tab.test.ts` lê o código-fonte da
 * aba e `tests/api/partner-place-link.test.ts` prova a decisão pura; nenhum dos dois renderiza,
 * e o defeito deste card É a renderização — a busca existia no arquivo o tempo todo, dentro de
 * uma condição que o cliente com um local não satisfaz. Só um DOM responde a *"a ação está
 * disponível?"*.
 *
 * A FIXTURE É `page.route`: a aba não recebe nada por prop além do `clientId`, e lê tudo de
 * `GET /api/admin/partnerships/clients/{id}` — a mesma resposta que a esteira e a fila leem.
 *
 * Rodar: `npx playwright test -c playwright-ct.config.ts client-places-tab`.
 */

import { test, expect } from '@playwright/experimental-ct-react'
// `@playwright/experimental-ct-react` reexporta `test`/`expect`, mas não os TIPOS da página —
// eles moram em `@playwright/test`, e é de lá que vêm `Page` e `Route`.
import type { Page, Route } from '@playwright/test'
import { PlacesTabHarness, Wrapper } from './helpers'
import {
  SECOND_PLACE_FACTS,
  detailReadyToPublish,
  detailWithSecondPlace,
} from './fixtures/partnerships'
import { verdictFor, type LinkCandidate } from '@/lib/partnerships/place-link'
import type { PartnershipDetail } from '@/lib/services/partnership-service'

/** O cliente de `detailReadyToPublish()`, com um local já vinculado (`attr-0006`). */
const CLIENT_ID = 'client-0006'
const FIRST_PLACE_NAME = 'Pousada Vista Mar'
const SEARCH_TERM = 'Vista Mar'

function candidate(overrides: Partial<LinkCandidate> = {}): LinkCandidate {
  return {
    attractionId: SECOND_PLACE_FACTS.attractionId,
    name: SECOND_PLACE_FACTS.name,
    city: 'Ubatuba',
    state: 'SP',
    country: 'BR',
    entityKind: 'place',
    approved: true,
    hasCoordinate: true,
    partnerClientId: null,
    ...overrides,
  }
}

interface Api {
  /** Uma ficha por leitura, na ordem; a última se repete. A segunda é a de depois do vínculo. */
  details: PartnershipDetail[]
  candidates: LinkCandidate[]
  /** O que o painel de fato mandou vincular — a prova de que o POST saiu com o POI certo. */
  linked: string[]
}

/**
 * O veredito servido é `verdictFor`, o MESMO módulo puro que a rota aplica. Uma fixture com o
 * veredito escrito à mão provaria que a tela desenha o que a fixture mandou, e não que ela
 * desenha o que a regra decide (CLAUDE.md §6, DRY).
 */
async function stubApi(page: Page, api: Api): Promise<void> {
  await page.route('**/api/admin/partnerships/clients/**', async (route: Route) => {
    const url = new URL(route.request().url())

    if (url.pathname.endsWith('/places/candidates')) {
      return route.fulfill({
        json: {
          candidates: api.candidates.map((c) => ({ ...c, verdict: verdictFor(c, CLIENT_ID) })),
          scope: 'Ubatuba',
        },
      })
    }

    if (url.pathname.endsWith('/places/link')) {
      const body = JSON.parse(route.request().postData() ?? '{}') as { attractionId?: string }
      api.linked.push(body.attractionId ?? '')
      return route.fulfill({ json: { ok: true } })
    }

    const detail = api.details.length > 1 ? api.details.shift() : api.details[0]
    return route.fulfill({ json: { detail } })
  })
}

test.describe('BR-B2B-033 item 3 — um cliente tem N locais, e a tela oferece o segundo', () => {
  test('o cliente que já tem um local vinculado busca no catálogo e vincula o segundo', async ({
    mount,
    page,
  }) => {
    const api: Api = {
      // A primeira leitura tem UM local; a de depois do vínculo tem os dois.
      details: [detailReadyToPublish(), detailWithSecondPlace()],
      candidates: [candidate()],
      linked: [],
    }
    await stubApi(page, api)

    const component = await mount(
      <Wrapper>
        <PlacesTabHarness clientId={CLIENT_ID} />
      </Wrapper>
    )

    // O estado de partida: um local na lista, que é onde a porta sumia.
    await expect(
      component.getByRole('heading', { name: FIRST_PLACE_NAME, exact: true })
    ).toBeVisible()

    // A PORTA EXISTE COM UM LOCAL JÁ VINCULADO — é isto que o card pede.
    await expect(
      component.getByRole('heading', { name: 'Este lugar já está no catálogo?' })
    ).toBeVisible()

    await component.getByLabel('Procurar pelo nome').fill(SEARCH_TERM)
    await component.getByRole('button', { name: 'Vincular', exact: true }).click()

    // O POST saiu com o POI escolhido, e a lista recarregada mostra os DOIS endereços do CNPJ.
    await expect(
      component.getByRole('heading', { name: SECOND_PLACE_FACTS.name, exact: true })
    ).toBeVisible()
    await expect(
      component.getByRole('heading', { name: FIRST_PLACE_NAME, exact: true })
    ).toBeVisible()
    expect(api.linked).toEqual([SECOND_PLACE_FACTS.attractionId])
  })

  test('o local de OUTRO cliente continua recusado, e a tela diz por quê', async ({
    mount,
    page,
  }) => {
    const api: Api = {
      details: [detailReadyToPublish()],
      // 1 : N não é N : 1 — dois parceiros apontando para um POI são duas divisões de receita
      // sobre um endereço (`lib/partnerships/place-link`).
      candidates: [candidate({ partnerClientId: 'client-0009' })],
      linked: [],
    }
    await stubApi(page, api)

    const component = await mount(
      <Wrapper>
        <PlacesTabHarness clientId={CLIENT_ID} />
      </Wrapper>
    )

    await component.getByLabel('Procurar pelo nome').fill(SEARCH_TERM)

    // O candidato recusado APARECE, com o motivo — filtrá-lo devolveria lista vazia sobre um
    // POI que existe, e o operador criaria a duplicata de novo.
    await expect(component.getByText('Já é o local de outro cliente.')).toBeVisible()
    await expect(component.getByRole('button', { name: 'Vincular', exact: true })).toHaveCount(0)
    expect(api.linked).toEqual([])
  })

  test('regressão: o cliente sem local nenhum continua vendo a busca ANTES do botão de criar', async ({
    mount,
    page,
  }) => {
    const api: Api = {
      details: [{ ...detailReadyToPublish(), places: [] }],
      candidates: [],
      linked: [],
    }
    await stubApi(page, api)

    const component = await mount(
      <Wrapper>
        <PlacesTabHarness clientId={CLIENT_ID} />
      </Wrapper>
    )

    await expect(component.getByText('Este cliente ainda não tem local vinculado.')).toBeVisible()

    const search = component.getByRole('heading', { name: 'Este lugar já está no catálogo?' })
    const create = component.getByRole('button', { name: 'Criar um local novo' })
    await expect(search).toBeVisible()
    await expect(create).toBeVisible()

    // A ORDEM É O CONSERTO DE 2026-08-23: três de três clientes que criaram direto ficaram com
    // uma linha vazia ao lado do estabelecimento já publicado.
    const searchBox = await search.boundingBox()
    const createBox = await create.boundingBox()
    expect(searchBox && createBox && searchBox.y < createBox.y).toBe(true)
  })

  test('criar a partir da proposta NÃO é oferecido ao cliente que já tem local', async ({
    mount,
    page,
  }) => {
    /**
     * E o motivo não é de layout: `provisionPartnerPlace` monta o prefill a partir da proposta
     * promovida do cliente, e a promoção reconhece o CNPJ e ATUALIZA o cadastro existente
     * (BR-B2B-028, item 2) — um cliente pode ter mais de uma promovida, e qual delas alimenta o
     * segundo local é decisão em aberto. O caminho do segundo endereço é o catálogo.
     */
    const api: Api = { details: [detailReadyToPublish()], candidates: [], linked: [] }
    await stubApi(page, api)

    const component = await mount(
      <Wrapper>
        <PlacesTabHarness clientId={CLIENT_ID} />
      </Wrapper>
    )

    await expect(
      component.getByRole('heading', { name: 'Este lugar já está no catálogo?' })
    ).toBeVisible()
    await expect(component.getByRole('button', { name: 'Criar um local novo' })).toHaveCount(0)
  })
})
