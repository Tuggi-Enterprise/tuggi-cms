/**
 * ONDE PROCURAR O LOCAL DO PARCEIRO — o recorte que torna a busca assertiva sem esconder nada.
 *
 * O PROBLEMA QUE ELE RESOLVE. `Garota Beer` num catálogo de 2,2 milhões de linhas traz o bar de
 * Cabo Frio junto com homônimos de qualquer lugar, e o operador escolhe no escuro. O cliente já
 * diz onde fica; usar isso é o recorte óbvio.
 *
 * O PROBLEMA QUE ELE **NÃO** PODE CRIAR, e é o motivo de este módulo existir em vez de um `AND`
 * na query. Os dois lados guardam localização em padrões diferentes:
 *
 *   `core.attractions`  — o canônico de `lib/shared/location-normalize`: `Brazil`, `Rio de Janeiro`
 *   `partner.clients`   — o que o parceiro digitou no formulário: `BR`, `RJ`, `barueri`
 *
 * Medido em 2026-08-23 sobre os 16 clientes: um filtro de igualdade em `country AND state AND
 * city` devolveria **zero para 11 deles** — `CAFETERIA ENCONTROS` (`Brazil / RJ / Cabo Frio`)
 * casa 0 de 154, `Leandro's Bar` (`BR / SP / barueri`) casa 0 de 96, e 8 clientes têm os três
 * campos nulos. **Zero resultado é exatamente o que faz o operador criar a duplicata**, que é o
 * defeito que a busca existe para impedir.
 *
 * DAÍ AS TRÊS REGRAS:
 *
 *  1. **A cidade decide, e o estado não entra.** `state` é onde os dois padrões mais divergem
 *     (`RJ` contra `Rio de Janeiro`) e é o campo que menos separa: duas cidades homônimas no
 *     mesmo país são raras o bastante para não valer o filtro que apaga 11 de 16.
 *  2. **A comparação é por `slug`** — o mesmo de `location-normalize`, minúsculas sem acento e
 *     sem pontuação. `barueri` acha `Barueri`, `CABO FRIO` acha `Cabo Frio`, `Sao Paulo` acha
 *     `São Paulo`. Não é um normalizador novo: é o que já normaliza a escrita dos POIs.
 *  3. **Sem cidade não há recorte.** Um cliente com `city` nulo busca no catálogo inteiro, que é
 *     como a busca funcionava antes deste módulo. Filtrar por um campo vazio devolveria nada.
 *
 * E o recorte NUNCA é silencioso: `outsideCount` diz quantos ficaram de fora, para a tela
 * oferecer o resto em vez de deixar o operador achar que não existe.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * O RECORTE TAMBÉM VAI PARA O `WHERE`, E AÍ ELE É PERFORMANCE — medido em 2026-08-23, sob o role
 * `authenticated` que a rota realmente usa:
 *
 *   sem recorte, com `ORDER BY approved DESC`   64.030 ms   211.606 buffers   57014 (timeout)
 *   `country` + `state`                          1.413 ms     7.949 buffers
 *   `country` + `state` + `city`                     5 ms       233 buffers
 *
 * A busca ficava 64 SEGUNDOS por duas causas somadas. A primeira é o `ORDER BY approved DESC`
 * que estava aqui: ele deu ao planner a saída de varrer `idx_attractions_approved` de ponta a
 * ponta em vez de usar o índice trigram, e ele varreu — 2.646.463 linhas removidas por filtro.
 * A segunda é que `core.attractions` carrega **12 policies permissivas de SELECT**, que o
 * Postgres combina em um `OR` gigante com `EXISTS` sobre `cms_users` dentro; nenhuma delas é
 * indexável, então cada linha varrida paga o predicado inteiro. Medindo como `postgres`, sem
 * RLS, a mesma busca custava 128 ms — o que mede o RLS, não a busca.
 *
 * `idx_attractions_geo_search (country, state, city)` resolve as duas: o índice entrega dezenas
 * de linhas em vez de milhões, e o predicado de RLS passa a rodar sobre elas.
 */

import { slug } from '@/lib/shared/location-normalize'

/**
 * O que a busca usa para recortar. `null` quando o cliente não diz onde fica.
 *
 * OS TRÊS CAMPOS VÃO PARA O `WHERE`, e isso é performance e não estética — ver o cabeçalho.
 * `key` continua existindo para o recorte em memória, que é a rede quando a grafia da cidade do
 * cadastro não é a do catálogo.
 */
export interface PlaceScope {
  /** Como o cliente escreveu — é isto que a tela mostra ao operador. */
  city: string
  /** `slug(city)`, que é por onde a comparação em memória acontece. */
  key: string
  /** `partner.clients.country`, canônico desde o backfill de 2026-08-23. */
  country: string | null
  /** `partner.clients.state`, idem. `null` para país sem divisão preenchida. */
  state: string | null
}

export type ScopeMode = 'city' | 'all'

/** O modo que a busca abre. O recorte, porque o resultado certo quase sempre está nele. */
export const DEFAULT_SCOPE: ScopeMode = 'city'

export function isScopeMode(value: unknown): value is ScopeMode {
  return value === 'city' || value === 'all'
}

export function scopeOf(client: {
  city: string | null
  country?: string | null
  state?: string | null
}): PlaceScope | null {
  const city = (client.city ?? '').trim()
  if (city.length === 0) return null
  return {
    city,
    key: slug(city),
    country: (client.country ?? '').trim() || null,
    state: (client.state ?? '').trim() || null,
  }
}

/**
 * O RECORTE EM MEMÓRIA SAIU EM 2026-08-23, e a ausência é a decisão.
 *
 * Ele existia para o caso de a grafia da cidade do cadastro não ser a do catálogo (`barueri`
 * contra `Barueri`), e a comparação por `slug` resolvia isso. Mas o recorte precisou ir para o
 * `WHERE` por performance — sem ele a busca levava 64 segundos —, e ali a comparação é
 * igualdade. Filtrar de novo em memória depois disso não removeria nada: o que o `WHERE` deixou
 * passar já está na cidade certa.
 *
 * O QUE RESOLVE A GRAFIA AGORA É O CADASTRO, e é onde tem de ser: `country` e `state` passaram
 * pelo `normalizeLocation` (na promoção e no backfill), e `city` foi conferida contra o catálogo
 * — `barueri` virou `Barueri` na linha do cliente. Uma cidade que ainda assim não casar devolve
 * lista vazia, e a tela oferece `Procurar em qualquer cidade`, que é o caminho de saída.
 *
 * `slug` continua aqui porque `key` o usa: é o que uma tela ou um teste compara sem ir ao banco.
 */
