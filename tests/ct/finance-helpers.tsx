/**
 * O provider que o módulo Financeiro precisa para montar — em ARQUIVO PRÓPRIO, e não dentro do
 * spec, porque o `@playwright/experimental-ct-react` recusa montar um componente declarado no
 * arquivo de teste ("Component ... cannot be mounted. Most likely, this component is defined in
 * the test file. Create a test story instead."). A suíte inteira falhava no `mount` por isso, e
 * não por nada da tela: é a mesma convenção que `tests/ct/helpers.tsx` já segue para as sete
 * outras suítes.
 *
 * NÃO É O `Wrapper` DE PARCERIAS, pelo motivo que o spec já registrava: aquele declara os
 * namespaces das telas de parceria e monta `QueryProvider` porque `PlaceFormModal` o exige;
 * esta tela não usa react-query e precisa do namespace `Finance`. Emprestar o wrapper de lá
 * acoplaria duas suítes que não compartilham nada além da moldura.
 *
 * O `Header` NÃO ENTRA, como lá: ele exige `SessionContextProvider` e o roteador tipado do
 * next-intl, que não resolvem fora de um request real do app router.
 */

import { NextIntlClientProvider } from 'next-intl'
import ptMessages from '@/messages/pt.json'

export function FinanceWrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="pt" messages={{ Finance: ptMessages.Finance }}>
      {children}
    </NextIntlClientProvider>
  )
}
