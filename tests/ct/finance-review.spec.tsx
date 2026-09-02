/**
 * PASSADA DE INSPEÇÃO — não é suíte de guarda, é olho.
 *
 * `finance-a11y.spec.tsx` AFIRMA (e falha quando algo quebra). Este arquivo OLHA: roda `axe` e
 * imprime as violações compactadas por regra, e salva um PNG de cada seção em três larguras.
 * Existe para responder "como está a tela de verdade", que é a pergunta que nenhuma leitura de
 * código responde.
 *
 * Temporário por natureza: some quando a revisão termina.
 */

import { test } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { FinancePageContent } from '@/components/finance/FinancePageContent'
import { FinanceWrapper as Wrapper } from './finance-helpers'
import { mockAll } from './finance-fixtures'

const SECTIONS = ['Parceiros', 'Catálogo e compras', 'Estrutura'] as const
const WIDTHS = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'laptop', width: 1180, height: 900 },
] as const

async function axeReport(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .include('#root')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const lines = results.violations.map(
    (v) => `    [${v.impact}] ${v.id} ×${v.nodes.length} — ${v.help}`
  )
  console.log(`\n=== AXE · ${label} — ${results.violations.length} regra(s) ===`)
  console.log(lines.length ? lines.join('\n') : '    (limpo)')
  for (const v of results.violations) {
    for (const node of v.nodes.slice(0, 3)) {
      console.log(`      ${v.id} → ${node.target.join(' ')}`)
      console.log(`        ${node.html.slice(0, 160).replace(/\s+/g, ' ')}`)
    }
  }
}

for (const size of WIDTHS) {
  test(`inspeção ${size.name}`, async ({ mount, page }) => {
    page.on('pageerror', (e) => console.log('!!! PAGEERROR:', e.message.slice(0, 400)))
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('!!! CONSOLE:', m.text().slice(0, 400))
    })
    await page.setViewportSize({ width: size.width, height: size.height })
    await mockAll(page)
    const component = await mount(
      <Wrapper>
        <FinancePageContent />
      </Wrapper>
    )
    await page.waitForTimeout(600)

    for (const section of SECTIONS) {
      await component.getByRole('button', { name: section, exact: true }).click()
      await page.waitForTimeout(400)
      const slug = section.replace(/[^a-zA-Z]/g, '').toLowerCase()
      await page.screenshot({
        path: `test-results/shots/${size.name}-${slug}.png`,
        fullPage: true,
      })
      if (size.name === 'desktop') await axeReport(page, section)

      // A linha que abre no catálogo é a peça que nunca foi vista rodando.
      if (section === 'Catálogo e compras') {
        const chevron = component.getByRole('button', { name: /^Abrir / }).first()
        if (await chevron.count()) {
          await chevron.click()
          await page.waitForTimeout(400)
          await page.screenshot({
            path: `test-results/shots/${size.name}-catalogo-aberto.png`,
            fullPage: true,
          })
          if (size.name === 'desktop') await axeReport(page, 'Catálogo · linha aberta')
          // O nome acessível vira "Fechar …" depois de abrir — o localizador de "Abrir" já não
          // resolve, e reusá-lo era o que derrubava esta passada.
          await component.getByRole('button', { name: /^Fechar / }).first().click()
          await page.waitForTimeout(200)
        } else {
          console.log('\n!!! nenhum botão "Abrir" encontrado na tabela de produtos')
        }
      }
    }
  })
}
