/**
 * A RESPOSTA DO PLACES, reduzida ao que o CMS usa — o parser, e nada além dele.
 *
 * MOVER UMA CÂMERA É O LIMITE. Nada aqui vira coordenada gravada: `buildPlacePrefill` recusa por
 * escrito chamar `cms_set_attraction_coordinate` com um palpite, e `cms_set_attraction_coordinate`
 * continua alcançado por um caminho só, que começa num humano clicando no mapa (#371).
 *
 * POR QUE PLACES TEXT SEARCH E NÃO GEOCODING. Medido em 2026-08-23 contra a chave do projeto:
 * `maps/api/geocode` responde `REQUEST_DENIED` ("This API key is not authorized to use this
 * service or API"), e `places:searchText` responde. Não é preferência de API — é a única das
 * duas que a chave abre. Se a Geocoding for habilitada um dia, ela continua sendo a errada para
 * este uso: procurar `Tucas Empório Bistrô, Cabo Frio` acha o ESTABELECIMENTO, e geocodificar
 * `R. Espírito Santo, 169` acha o meio da quadra.
 *
 * A CIDADE VOLTA CANÔNICA, e isso é o ganho colateral que mais importa. O `directory` mostra
 * hoje `Cabo Frio`, `CABO FRIO` e `Cabo FrioCabo Frio` como três facetas do mesmo município,
 * porque `city` é texto livre digitado. O Places devolve `administrative_area_level_2` — e
 * devolveu `Armação dos Búzios`, que é o nome do município e não o `Búzios` que todo mundo
 * digita.
 */

/** O que a busca devolve para uma consulta. `null` quando o Places não achou nada. */
export interface PlaceSearchResult {
  latitude: number
  longitude: number
  /** `formattedAddress` — o endereço que o Google casou, para o operador comparar com o dele. */
  formattedAddress: string
  /** O nome do estabelecimento que casou. Compare com o nome do local antes de aceitar. */
  name: string | null
  /** Os componentes que interessam, já resolvidos. Ver `pickAddress`. */
  city: string | null
  /** Sigla de duas letras — `shortText` de `administrative_area_level_1`. */
  state: string | null
  postalCode: string | null
  district: string | null
}

interface AddressComponent {
  longText?: string
  shortText?: string
  types?: string[]
}

export interface PlaceResult {
  location?: { latitude?: number; longitude?: number }
  formattedAddress?: string
  displayName?: { text?: string }
  addressComponents?: AddressComponent[]
}

/**
 * `locality` NÃO VEM NO BRASIL, e é por isso que a ordem importa.
 *
 * Medido em três municípios de porte diferente — Cabo Frio, São Paulo capital e Armação dos
 * Búzios: nos três `locality` veio ausente e `administrative_area_level_2` trouxe o município.
 * A ordem abaixo tenta `locality` primeiro mesmo assim, porque é o componente canônico fora do
 * Brasil e o formulário pode um dia atravessar a fronteira.
 */
const CITY_TYPES = ['locality', 'administrative_area_level_2']

function componentOf(
  components: AddressComponent[],
  types: string[],
  form: 'longText' | 'shortText'
): string | null {
  for (const type of types) {
    const found = components.find((component) => (component.types ?? []).indexOf(type) >= 0)
    const value = found?.[form]?.trim()
    if (value) return value
  }
  return null
}

/** O primeiro resultado, reduzido ao que a tela mostra. `null` quando não dá para usar. */
export function pickSuggestion(places: PlaceResult[] | undefined): PlaceSearchResult | null {
  const place = (places ?? [])[0]
  const latitude = place?.location?.latitude
  const longitude = place?.location?.longitude
  // Sem coordenada não há sugestão: é o único campo pelo qual este módulo existe, e um resultado
  // sem ele seria um endereço bonito que não marca nada no mapa.
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null

  const components = place.addressComponents ?? []

  return {
    latitude,
    longitude,
    formattedAddress: place.formattedAddress ?? '',
    name: place.displayName?.text ?? null,
    city: componentOf(components, CITY_TYPES, 'longText'),
    // `shortText`, e é o que o contrato da proposta pede: `state` é código de UF
    // (`BRAZIL_STATE_CODES`), não `Rio de Janeiro`.
    state: componentOf(components, ['administrative_area_level_1'], 'shortText'),
    postalCode: componentOf(components, ['postal_code'], 'longText'),
    district: componentOf(components, ['sublocality_level_1', 'sublocality'], 'longText'),
  }
}

/**
 * A consulta, montada do que se sabe do local.
 *
 * O NOME VEM PRIMEIRO porque a busca é por estabelecimento e não por logradouro: `Tucas Empório
 * Bistrô, R. Espírito Santo, Cabo Frio` acha a porta; `R. Espírito Santo, Cabo Frio` acha a rua.
 * Vazio quando não há nem nome nem endereço — e aí não há o que perguntar ao Google.
 */
export function buildQuery(parts: {
  name?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
}): string {
  return [parts.name, parts.address, parts.city, parts.state]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(', ')
}
