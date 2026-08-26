/**
 * O ENDEREÇO INTEIRO, para a geocodificação que centraliza o mapa — e não só o pedaço que o
 * parceiro digitou na linha da rua.
 *
 * O QUE ESTAVA INDO. `LocationPicker` recebe `core.attractions.formatted_address`, e para o local
 * que a aprovação do parceiro cria esse valor é o que `joinAddress` monta: rua, complemento e
 * bairro, **sem cidade, sem estado e sem CEP** (`lib/partner-form/promotion.ts`). No `Cozi +`
 * isso é a string `Av Assunção 606, São Bento` — medida em 26/08/2026. Uma consulta assim manda
 * `places:searchText` procurar uma avenida por nome no Brasil inteiro, e a câmera pode abrir a
 * 1.000 km do estabelecimento com a mesma aparência de acerto.
 *
 * A CIDADE E O ESTADO SEMPRE EXISTIRAM NO REGISTRO — `core.attractions.city` e `.state` são NOT
 * NULL na criação do local (`core.cms_create_place`) —, e o CEP existe quando o parceiro o
 * respondeu. Eles simplesmente não estavam sendo perguntados junto.
 *
 * ISTO NÃO VIRA COORDENADA, e o limite é o mesmo de `geocodeAddress`: move uma CÂMERA. Quem grava
 * coordenada é o clique do curador no mapa, por `cms_set_attraction_coordinate` (#371, decisão do
 * operador em 2026-08-17). Centro errado se corrige arrastando; coordenada errada gravada tem
 * aparência de verdade e atravessa a triagem.
 *
 * PARTE QUE O ENDEREÇO JÁ CONTÉM NÃO SE REPETE. `formatted_address` de um POI importado do Google
 * costuma trazer a cidade e o estado dentro; repeti-los produziria
 * `Rua X, Cabo Frio - RJ, Cabo Frio, Rio de Janeiro`, que é ruído para o buscador e não ajuda
 * ninguém. A comparação é sem acento e sem caixa, porque `Sao Bento` e `São Bento` são a mesma
 * parte escrita por duas mãos diferentes.
 */

export interface PlaceAddressParts {
  /** `core.attractions.formatted_address` — rua, complemento e bairro, quando existe. */
  address?: string | null
  postalCode?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
}

/** Sem acento, sem caixa e sem pontuação — só para COMPARAR, nunca para exibir ou consultar. */
function comparable(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * A consulta que vai para `/api/maps/geocode`, ou string vazia quando não há nada que valha
 * perguntar — e a string vazia é resposta legítima: `geocodeAddress` devolve `null` para ela e o
 * mapa abre onde abria antes.
 */
export function buildAddressQuery(parts: PlaceAddressParts): string {
  const address = (parts.address ?? '').trim()
  const haystack = comparable(address)

  const rest = [parts.postalCode, parts.city, parts.state, parts.country]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .filter((part) => {
      const needle = comparable(part)
      // Uma parte vazia depois de normalizada (pontuação solta) não acrescenta nada.
      if (!needle) return false
      return !haystack.includes(needle)
    })

  return [address, ...rest].filter((part) => part.length > 0).join(', ')
}
