/**
 * Bandeira do idioma do áudio, a partir do código BCP-47 gravado em
 * `drive.poi_visits.audio_language` (`pt-br`, `en-us`, `en-gb`, `es-es`, `it-it`,
 * `de-de`, `pt-pt`, `fr-fr`).
 *
 * A bandeira sai do **subtag de região**, não de um palpite sobre o idioma: `en`
 * sozinho não tem bandeira, e `en-us`/`en-gb` têm duas diferentes. Código sem
 * região devolve `null` e a UI mostra só a sigla.
 *
 * **A bandeira nunca vai sozinha.** O Windows não desenha bandeira regional —
 * o mesmo motivo pelo qual `LanguagesStrip` do site usa texto (spec-lp-parcerias,
 * §2.8): lá o par de indicadores regionais aparece como as duas letras do país.
 * Acompanhada da sigla, a degradação vira redundância em vez de perda.
 */

const REGIONAL_INDICATOR_A = 0x1f1e6
const ASCII_A = 'A'.charCodeAt(0)

/** `pt-br` → `🇧🇷`. Sem região (`pt`, `unknown`, vazio) → `null`. */
export function languageFlag(code?: string | null): string | null {
  const region = code?.split('-')[1]
  if (!region || region.length !== 2 || !/^[a-z]{2}$/i.test(region)) return null

  return [...region.toUpperCase()]
    .map((letter) => String.fromCodePoint(REGIONAL_INDICATOR_A + letter.charCodeAt(0) - ASCII_A))
    .join('')
}
