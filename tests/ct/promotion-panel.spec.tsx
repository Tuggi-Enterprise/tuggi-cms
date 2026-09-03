/**
 * #679 — o painel de promoção barra na TELA o valor que não cabe na coluna.
 *
 * O caso é o da proposta `6374b98c` de 2026-09-03: um `website` de 300 caracteres contra
 * `partner.clients.website`, que é `varchar(255)`. Sem esta barreira o INSERT volta `22001`, a
 * rota responde 503 e a proposta fica na fila sem caminho de saída.
 *
 * POR QUE AQUI E NÃO EM `tests/api`. A suíte de `node:test` prova a decisão
 * (`lengthViolations`, a recusa da rota, a resposta tipada) e não renderiza nada; o que o card
 * pede — o campo nomeado na tela, antes do POST — só um DOM responde. Esta é a única bancada de
 * render do repositório: `npx playwright test -c playwright-ct.config.ts promotion-panel`.
 *
 * Nada aqui promove: `PromotionHarness` passa `onPromoted` vazio e nenhum teste chega ao POST.
 *
 * Regras: DS-COMPONENTE-018 (o painel da promoção), BR-B2B-026 item 4 (a conferência é onde a
 * equipe corrige o que o formulário trouxe).
 */

import { test, expect } from '@playwright/experimental-ct-react'
import AxeBuilder from '@axe-core/playwright'
import { PromotionHarness, Wrapper } from './helpers'
import { proposalUnderConference } from './fixtures/partnerships'
import type { ProposalDetail } from '@/components/admin/partner-proposals/types'

/** A URL do card: `utm_*` e `fbclid` empilhados até passar de 255. */
const LONG_WEBSITE = `https://pedido.brendi.com.br/mangiacabofrio?${'utm_source=meta&fbclid=IwAR0abcdefgh&'.repeat(7)}`

function proposalWith(answers: Record<string, string>): ProposalDetail {
  const detail = proposalUnderConference()
  return {
    ...detail,
    submission: {
      ...detail.submission,
      answers: { ...detail.submission.answers, ...answers } as ProposalDetail['submission']['answers'],
    },
  }
}

test.describe('DS-COMPONENTE-018 — o valor que não cabe é barrado na tela', () => {
  test('BR-B2B-026: o campo é nomeado com o seu limite, e o botão de gravar morre', async ({
    mount,
  }) => {
    expect(LONG_WEBSITE.length).toBeGreaterThan(255)

    const component = await mount(
      <Wrapper>
        <PromotionHarness detail={proposalWith({ website: LONG_WEBSITE })} />
      </Wrapper>
    )

    // O CAMPO É NOMEADO, com o limite junto — "não foi possível promover" sozinho não diz o que
    // corrigir, e foi exatamente isso que o operador viu em 2026-09-03.
    //
    // E O EXCESSO VEM JUNTO. O limite sem o tamanho manda cortar às cegas: nesta URL sobram 45
    // caracteres, e é esse número que decide se o operador apaga um `utm_` ou reescreve tudo.
    await expect(
      component
        .getByText(
          new RegExp(
            `Site não cabe no cadastro: tem ${LONG_WEBSITE.length} caracteres e o limite é 255`
          )
        )
        .first()
    ).toBeVisible()

    // E a promoção não é oferecida enquanto o valor não couber.
    await expect(component.getByRole('button', { name: /^Gravar/ })).toBeDisabled()
  })

  test('#679: sem clique nenhum, o bloco anuncia BLOQUEIO — não uma falha que não houve', async ({
    mount,
  }) => {
    // O bloco vermelho aparece só de ABRIR o painel sobre um valor que já vem estourado da
    // proposta, e dizia `Não foi possível promover.` sobre um botão que ninguém apertou.
    // Prevenção não é relato de falha.
    const component = await mount(
      <Wrapper>
        <PromotionHarness detail={proposalWith({ website: LONG_WEBSITE })} />
      </Wrapper>
    )

    await expect(component.getByText('Falta corrigir um valor antes de promover.')).toBeVisible()
    await expect(component.getByText('Não foi possível promover.')).toHaveCount(0)
  })

  test('#679: a falha que de fato aconteceu continua com o título de falha', async ({
    mount,
    page,
  }) => {
    // A outra ponta da mesma condição: com a escrita recusada pelo servidor houve falha, e é a
    // frase de falha que tem que aparecer — trocar as duas era só mover o defeito de lado.
    await page.route('**/api/admin/partner-proposals/*/promote', (route) =>
      route.fulfill({ status: 503, json: { error: 'write_failed', clientWritten: false } })
    )

    const component = await mount(
      <Wrapper>
        <PromotionHarness detail={proposalWith({ website: 'https://brendi.com.br/mangia' })} />
      </Wrapper>
    )

    await component.getByRole('button', { name: /^Gravar/ }).click()

    await expect(component.getByText('Não foi possível promover.')).toBeVisible()
    await expect(component.getByText('Falta corrigir um valor antes de promover.')).toHaveCount(0)
    // E a frase honesta do desfecho, que é o resto do card: nada foi gravado.
    await expect(component.getByText(/Nada foi gravado/)).toBeVisible()
  })

  test('BR-B2B-026: o operador encurta o valor no próprio painel e o botão volta', async ({
    mount,
  }) => {
    const component = await mount(
      <Wrapper>
        <PromotionHarness detail={proposalWith({ website: LONG_WEBSITE })} />
      </Wrapper>
    )

    const field = component.getByLabel('Site')
    await expect(field).toHaveValue(LONG_WEBSITE)
    await field.fill('https://brendi.com.br/mangia')

    await expect(component.getByText(/não cabe no cadastro/)).toHaveCount(0)
    await expect(component.getByRole('button', { name: /^Gravar/ })).toBeEnabled()
  })

  test('#679: o campo aceita a digitação inteira — o cursor não sai a cada tecla', async ({
    mount,
  }) => {
    // A ARMADILHA QUE ISTO PEGA: declarar o campo como um componente DENTRO do render faz React
    // remontar o input a cada tecla, e o operador digita uma letra por clique. Um `fill` não
    // acusaria isso; `pressSequentially` sim.
    const component = await mount(
      <Wrapper>
        <PromotionHarness detail={proposalWith({ website: 'https://a.com' })} />
      </Wrapper>
    )

    // Sem nada estourando, os vazios continuam sendo uma contagem: a lista é o clique que a
    // abre, e é dentro dela que os campos existem.
    await component.getByRole('button', { name: 'Ver os campos' }).click()

    const field = component.getByLabel('Site')
    await field.fill('')
    await field.pressSequentially('https://brendi.com.br')

    await expect(field).toHaveValue('https://brendi.com.br')
  })

  test('DS-COMPONENTE-018: o painel cheio de campos continua sem violação de axe', async ({
    mount,
    page,
  }) => {
    // O painel virou um formulário: doze inputs, um deles em célula de tabela e um em estado de
    // erro. Cada rótulo tem que continuar amarrado ao seu campo, e o erro tem que ser anunciado.
    await mount(
      <Wrapper>
        <PromotionHarness
          detail={proposalWith({ website: LONG_WEBSITE, instagram: '@mangia' })}
        />
      </Wrapper>
    )

    const results = await new AxeBuilder({ page })
      .include('#root')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()

    expect(
      results.violations.map((violation) => `${violation.id}: ${violation.help}`),
      'axe reprovou o painel de promoção'
    ).toEqual([])
  })

  test('DS-COMPONENTE-018: o que a edição não faz está escrito na tela', async ({ mount }) => {
    const component = await mount(
      <Wrapper>
        <PromotionHarness detail={proposalWith({ website: 'https://brendi.com.br' })} />
      </Wrapper>
    )

    await expect(component.getByText(/continua guardado na proposta/)).toBeVisible()
  })
})
