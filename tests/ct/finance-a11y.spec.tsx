/**
 * O módulo Financeiro num Chromium real — o que `tests/api/finance-*.test.ts` não consegue afirmar.
 *
 * As seis suítes de `tests/api` provam as CONTAS sem banco e sem navegador: média ponderada com
 * rendimento, vigência de receita, os seis vereditos, a camada MC II. O que elas não alcançam é
 * o que só existe depois de o CSS resolver: `axe-core` limpo, contraste medido, alvo de 24×24 px,
 * e a garantia de que um veredito continua legível para quem não enxerga a cor (DS-A11Y-003).
 *
 * MONTAGEM DE COMPONENTE E NÃO NAVEGAÇÃO, pelo mesmo motivo de `partnerships-a11y.spec.tsx`: a
 * checagem de sessão de `proxy.ts` roda no servidor e não é alcançável por um hook de rota do
 * navegador, e esta suíte não tem credencial de CMS para logar de verdade. Toda chamada de rede
 * é interceptada por `page.route`.
 *
 * PROVIDER PRÓPRIO E NÃO O `Wrapper` DE PARCERIAS — ele mora em `finance-helpers.tsx`, porque
 * o runner recusa montar um componente declarado no próprio arquivo de teste. Aquele arquivo declara os namespaces das
 * telas de parceria e monta `QueryProvider` porque `PlaceFormModal` o exige; esta tela não usa
 * react-query e precisa do namespace `Finance`. Emprestar o wrapper de lá acoplaria duas suítes
 * que não compartilham nada além da moldura.
 *
 * O `Header` NÃO ENTRA, como lá: ele exige `SessionContextProvider` e o roteador tipado do
 * next-intl, que não resolvem fora de um request real do app router.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { FinancePageContent } from '@/components/finance/FinancePageContent'
import { FinanceWrapper as Wrapper } from './finance-helpers'
// As fixtures moram em `finance-fixtures.ts` para a passada de inspeção usar EXATAMENTE as
// mesmas: duas cópias divergem, e aí as duas suítes passam a falar de telas diferentes — foi
// assim que `packaging` existia numa e faltava na outra.
import { mockAll } from './finance-fixtures'

/** Nenhuma violação de `axe` nas regras de A e AA. */
async function expectAxeClean(page: Page) {
  const results = await new AxeBuilder({ page })
    // Escopado ao componente montado, e não ao documento — a mesma decisão (e o mesmo motivo)
    // que `partnerships-a11y.spec.tsx` já registrava: `playwright/index.html` é fixture de teste
    // de componente, não rota, e não tem `<title>` nem `<html lang>`. Sem o escopo, as três
    // seções reprovavam em `document-title`, que mede o harness e não a tela. Quem põe os dois
    // na tela real é `app/[locale]/layout.tsx`.
    .include('#root')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(
    results.violations,
    results.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help}`).join(' · ')
  ).toEqual([])
}

test.describe('as três seções passam no axe', () => {
  test('Parceiros', async ({ mount, page }) => {
    await mockAll(page)
    const component = await mount(
      <Wrapper>
        <FinancePageContent />
      </Wrapper>
    )
    await expect(component.getByText('Baires Bistrô')).toBeVisible()
    await expectAxeClean(page)
  })

  test('Catálogo e compras', async ({ mount, page }) => {
    await mockAll(page)
    const component = await mount(
      <Wrapper>
        <FinancePageContent />
      </Wrapper>
    )
    await component.getByRole('button', { name: 'Catálogo e compras' }).click()
    await expect(component.getByText('Display de mesa').first()).toBeVisible()
    await expectAxeClean(page)
  })

  test('Estrutura', async ({ mount, page }) => {
    await mockAll(page)
    const component = await mount(
      <Wrapper>
        <FinancePageContent />
      </Wrapper>
    )
    await component.getByRole('button', { name: 'Estrutura' }).click()
    await expect(component.getByText('Impressora de etiquetas')).toBeVisible()
    await expectAxeClean(page)
  })
})

test('DS-A11Y-003: o veredito é texto, e a diferença entre dois vereditos chega a quem não vê a cor', async ({
  mount,
  page,
}) => {
  await mockAll(page)
  const component = await mount(
    <Wrapper>
      <FinancePageContent />
    </Wrapper>
  )

  // Os dois vereditos da fixture aparecem escritos, não como cor.
  //
  // ESCOPADO AO `tbody` porque o mesmo rótulo agora existe DUAS vezes na tela, de propósito: o
  // veredito da linha e o chip que filtra por ele. São papéis diferentes — um `span` que descreve
  // e um `button` que age — e quem usa leitor ouve a diferença ("Se paga, botão, não pressionado"
  // contra "Se paga — A mensalidade acumulada já cobriu o custo"). O que este teste guarda é o
  // veredito da LINHA, então é nele que ele encosta.
  const rows = component.locator('tbody')
  await expect(rows.getByText('Se paga')).toBeVisible()
  await expect(rows.getByText('Só custo')).toBeVisible()

  // E a explicação — que é o que separa "só custo" de "retorno não medido em R$" — está no DOM
  // para o leitor de tela, não só no `title`.
  await expect(
    component.getByText('Não paga mensalidade e nenhum usuário vindo dele comprou.', { exact: false })
  ).toHaveCount(1)
})

test('ausência imprime travessão, nunca R$ 0,00 nem zero', async ({ mount, page }) => {
  await mockAll(page)
  const component = await mount(
    <Wrapper>
      <FinancePageContent />
    </Wrapper>
  )

  // `Pousada do Alto` tem payback, CAC, minutos E pedidos-sem-envio nulos: QUATRO ausências na
  // mesma linha. Esta asserção dizia três — escrita antes de a coluna `Sem envio` existir, e
  // nunca corrigida porque a suíte inteira falhava no `mount` e nunca chegou aqui.
  //
  // `exact: true` PORQUE O BADGE TAMBÉM TEM UM TRAVESSÃO. A dica de leitor de tela do veredito é
  // `<span class="sr-only"> — {hint}</span>`, e busca por substring casava com ela: cinco
  // resultados para quatro ausências. Exato faz a asserção dizer o que ela pretende — células
  // cujo conteúdo INTEIRO é o travessão.
  const row = component.locator('tr', { hasText: 'Pousada do Alto' })
  await expect(row.getByText('—', { exact: true })).toHaveCount(4)
})

test('alvos de 24×24 CSS px no trilho de seções', async ({ mount, page }) => {
  await mockAll(page)
  const component = await mount(
    <Wrapper>
      <FinancePageContent />
    </Wrapper>
  )

  for (const name of ['Parceiros', 'Catálogo e compras', 'Estrutura']) {
    const box = await component.getByRole('button', { name }).boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24)
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(24)
  }
})

test('o 503 do lado do app diz o que aconteceu, e não desenha veredito nenhum', async ({
  mount,
  page,
}) => {
  await mockAll(page, { error: 'app_users_unavailable' }, 503)
  const component = await mount(
    <Wrapper>
      <FinancePageContent />
    </Wrapper>
  )

  await expect(component.getByRole('alert')).toContainText('usuários do app')
  // Nenhum veredito é afirmado sobre parceiro nenhum enquanto a leitura não responde.
  await expect(component.getByText('Só custo')).toHaveCount(0)
  await expect(component.getByRole('button', { name: 'Tentar de novo' })).toBeVisible()
})

test('o tipo da esteira sem produto aparece como pendência de cadastro', async ({ mount, page }) => {
  await mockAll(page)
  const component = await mount(
    <Wrapper>
      <FinancePageContent />
    </Wrapper>
  )
  await component.getByRole('button', { name: 'Catálogo e compras' }).click()

  // `sticker` não tem produto na fixture: a tela diz isso em vez de deixar o pedido sair de graça.
  //
  // Há DOIS `role="status"` nesta tela — a ressalva das compras do app e esta pendência de
  // cadastro — e as duas são legítimas: avisam de coisas diferentes. O filtro nomeia qual delas
  // está sob teste em vez de assumir que só existe uma.
  await expect(
    component.getByRole('status').filter({ hasText: 'Tipos da esteira sem produto' })
  ).toContainText('sticker')
})
