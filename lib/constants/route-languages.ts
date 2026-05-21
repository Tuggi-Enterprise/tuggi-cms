/**
 * route-languages.ts
 *
 * SSOT para a lista de idiomas suportados nas rotas customizadas.
 * Usado por RouteEditorModal (selector de idioma do conteúdo base)
 * e RouteTranslationsPanel (grid de seleção de idiomas para tradução).
 */

export interface RouteLang {
  code:      string
  name:      string   // nome completo (ex: "Português (Brasil)")
  sub?:      string   // subtítulo curto para o grid (ex: "Brasil")
  flag:      string   // emoji de bandeira
  isBase?:   boolean  // true = idioma base (não traduzível via EF)
}

/** Todos os idiomas disponíveis (inclui o base pt-br) */
export const ROUTE_LANGUAGES: RouteLang[] = [
  { code: 'pt-br', name: 'Português (Brasil)',  sub: 'Brasil',   flag: '🇧🇷', isBase: true },
  { code: 'pt-pt', name: 'Português (Portugal)', sub: 'Portugal', flag: '🇵🇹' },
  { code: 'en-us', name: 'English (US)',          sub: 'US',       flag: '🇺🇸' },
  { code: 'en-gb', name: 'English (UK)',          sub: 'UK',       flag: '🇬🇧' },
  { code: 'es-es', name: 'Español',               sub: 'España',   flag: '🇪🇸' },
  { code: 'fr-fr', name: 'Français',              sub: 'France',   flag: '🇫🇷' },
  { code: 'de-de', name: 'Deutsch',               sub: 'DE',       flag: '🇩🇪' },
  { code: 'it-it', name: 'Italiano',              sub: 'IT',       flag: '🇮🇹' },
  { code: 'ja-jp', name: '日本語',                sub: 'JP',       flag: '🇯🇵' },
]

/** Idiomas disponíveis para tradução (exclui o idioma base) */
export const TRANSLATABLE_LANGS = ROUTE_LANGUAGES.filter(l => !l.isBase)

/** Idiomas default pré-selecionados no painel de tradução */
export const DEFAULT_SELECTED_LANGS = ['en-us', 'fr-fr', 'de-de', 'es-es']

/** Mapeia locale do next-intl para o nosso código de idioma */
export function localeToLangCode(locale: string): string {
  const map: Record<string, string> = {
    pt: 'pt-br', 'pt-BR': 'pt-br', 'pt-PT': 'pt-pt',
    en: 'en-us', 'en-US': 'en-us', 'en-GB': 'en-gb',
    es: 'es-es', fr: 'fr-fr', de: 'de-de', it: 'it-it', ja: 'ja-jp',
  }
  return map[locale] ?? locale.toLowerCase().replace('_', '-')
}
