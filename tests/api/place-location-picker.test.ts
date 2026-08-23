/**
 * The pin of the partner's place — #371, épico #356.
 *
 * THE GUARANTEE THIS SUITE EXISTS FOR is a negative one: the geocoded address moves the CAMERA
 * and never becomes a coordinate. A wrong map centre is corrected by dragging; a wrong coordinate
 * on the record has the appearance of truth, passes gate 1 of BR-B2B-011 (BR-POI-004, "localização
 * resolvível") and reaches the tourist. So the map may open over the address, and only a human
 * click may write one — the decision of the operator on 2026-08-17.
 *
 * Mutations run against this suite, each one turning it red:
 *  · showing a marker on the geocoded centre (it would read as a coordinate nobody set);
 *  · calling `onChange` from the geocoding effect;
 *  · letting `LocationPicker` reach `placeService`/`cms_set_attraction_coordinate`;
 *  · a second forward geocoder anywhere in the CMS;
 *  · rendering the legend only for `source === 'address'` (the failure goes mute — #371, item 1);
 *  · a legend that blames the address instead of saying we could not locate it.
 *
 * Run with: npm run test:api
 */

import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  ADDRESS_ZOOM,
  COORDINATE_ZOOM,
  FALLBACK_CENTER,
  FALLBACK_ZOOM,
  pickLocationCaption,
  pickLocationPickerView,
} from '@/lib/maps/location-picker-view'
import { GEOCODE_ENDPOINT, geocodeAddress } from '@/lib/maps/geocode-address'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

function read(relative: string): string {
  return readFileSync(resolve(REPO_ROOT, relative), 'utf8')
}

/** The source without its comments — a static ruler that reads prose measures the prose. */
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const PICKER = 'components/entity-management/LocationPicker.tsx'

// ── Where the map opens, and what it shows ───────────────────────────────────────────────────

test('#371 · BR-POI-004: the coordinate on the record wins, with the pin and the close zoom', () => {
  const view = pickLocationPickerView({
    latitude: -22.75,
    longitude: -41.88,
    geocoded: { lat: -23.55, lng: -46.63 },
  })

  assert.deepEqual(view.center, { lat: -22.75, lng: -41.88 })
  assert.equal(view.zoom, COORDINATE_ZOOM)
  assert.equal(view.showMarker, true)
  assert.equal(view.source, 'coordinate')
})

test('#371: with no coordinate, the map opens over the ADDRESS — and shows NO pin', () => {
  const view = pickLocationPickerView({
    latitude: null,
    longitude: null,
    geocoded: { lat: -22.7469, lng: -41.8817 },
  })

  assert.deepEqual(view.center, { lat: -22.7469, lng: -41.8817 })
  assert.equal(view.zoom, ADDRESS_ZOOM)
  // THE ASSERTION OF THE CARD, in the form a screen can be held to: a marker the operator did not
  // place is a coordinate the record does not have, wearing the clothes of one.
  assert.equal(view.showMarker, false)
  assert.equal(view.source, 'address')
})

test('#371 item 3: geocoding that answers nothing falls back to the old behaviour', () => {
  const view = pickLocationPickerView({ latitude: null, longitude: null, geocoded: null })

  assert.deepEqual(view.center, FALLBACK_CENTER)
  assert.equal(view.zoom, FALLBACK_ZOOM)
  assert.equal(view.showMarker, false)
  assert.equal(view.source, 'fallback')
  // São Paulo, which is where this map has always opened when nothing is known.
  assert.deepEqual(FALLBACK_CENTER, { lat: -23.5505, lng: -46.6333 })
})

test('#371: the address zoom is wider than the coordinate zoom, because it resolved a street', () => {
  assert.equal(COORDINATE_ZOOM > ADDRESS_ZOOM, true)
  assert.equal(ADDRESS_ZOOM > FALLBACK_ZOOM, true)
})

// ── The legend, in the state of FAILURE — #371, `design` item 1 ───────────────────────────────

test('#371 item 1 · DS-COMPONENTE-002: with no coordinate there is ALWAYS a legend', () => {
  const editable = { editable: true, locating: false }

  // The three forms `design` wrote, and what separates them: `source` tells the centred map from
  // the failed one, and `hasAddress` tells the failure from the absence.
  assert.equal(
    pickLocationCaption({ ...editable, source: 'address', hasAddress: true }),
    'centered'
  )
  assert.equal(
    pickLocationCaption({ ...editable, source: 'fallback', hasAddress: true }),
    'not_located',
    'ZERO_RESULTS, an SDK that never loads and a null formatted_address all land here'
  )
  assert.equal(
    pickLocationCaption({ ...editable, source: 'fallback', hasAddress: false }),
    'no_address'
  )

  // Carrying wins over all three while the answer is out: the camera opens on the fallback and
  // moves when the geocoding lands, and a map that jumps with no warning reads as a bug.
  assert.equal(
    pickLocationCaption({ editable: true, locating: true, source: 'fallback', hasAddress: true }),
    'locating'
  )

  // And the two cases with nothing to say: the pin is the record's, or nobody may edit it.
  assert.equal(
    pickLocationCaption({ ...editable, source: 'coordinate', hasAddress: true }),
    null
  )
  assert.equal(
    pickLocationCaption({ editable: false, locating: false, source: 'fallback', hasAddress: true }),
    null
  )
})

test('#371 item 1: the three legends of a missing coordinate all say `clique no mapa`', () => {
  const pt = JSON.parse(read('messages/pt.json')).Modals.PlaceDetails as Record<string, string>

  // The sentence that teaches the ONLY way to set the coordinate. It used to exist only on the
  // happy path — which is the one place the operator does not need it.
  for (const key of ['address_centered', 'address_not_located', 'address_missing']) {
    assert.match(pt[key], /clique no mapa/i, `${key} has to teach the act`)
  }

  // We say we could not LOCATE the address, never that it is wrong: that is what we know.
  assert.match(pt.address_not_located, /não foi possível localizar/i)
  assert.equal(/endereço (está )?(errado|inválido|incorreto)/i.test(pt.address_not_located), false)
  assert.match(pt.address_missing, /não tem endereço no cadastro/i)
  assert.match(pt.address_locating, /localizando/i)
})

test('#371 item 2: the picker reserves the legend space and hands all four captions down', () => {
  const picker = code(PICKER)

  // The legend renders off the pure decision, and the space is reserved from the first render so
  // that the text changing does not push the map the operator is using.
  assert.match(picker, /pickLocationCaption\(\{/)
  assert.match(picker, /caption !== null/)
  assert.match(picker, /min-h-\[2rem\]/)
  // `locating` is its own state: `geocoded === null` answers two different questions.
  assert.match(picker, /setLocating\(true\)/)
  assert.match(picker, /\.finally\(/, 'a rejected promise must not leave the legend at Localizando…')

  // The four are handed down translated, because this picker is used under more than one
  // namespace and a missing one renders the key name.
  const modal = code('components/place-management/PlaceFormModal.tsx')
  for (const key of ['address_locating', 'address_centered', 'address_not_located', 'address_missing']) {
    assert.match(modal, new RegExp(`t\\('${key}'\\)`), `the modal must pass ${key}`)
  }
})

// ── The geocoding itself ─────────────────────────────────────────────────────────────────────

interface FakeGeocode {
  status: string
  results: unknown[]
}

/**
 * A CHAMADA DEIXOU DE SER O SDK DO NAVEGADOR EM 2026-08-23, e o motivo está no cabeçalho de
 * `geocode-address`: `google.maps.Geocoder` exige a Geocoding API, que esta chave nega
 * (`REQUEST_DENIED`, medido). A centralização do #371 nunca funcionou, e falhava em silêncio.
 * Agora a pergunta vai para `/api/maps/geocode`, que responde com `places:searchText`.
 *
 * O QUE ESTA SUÍTE PROVA NÃO MUDOU: o ponto move a câmera, o endereço em branco não vira
 * requisição, e falha nenhuma bloqueia a tela. É o mecanismo que trocou, não a promessa.
 */
function stubFetch(answer: unknown, spy?: { address?: string; url?: string }) {
  ;(globalThis as any).fetch = async (url: string, init?: { body?: string }) => {
    if (spy) {
      spy.url = url
      spy.address = JSON.parse(init?.body ?? '{}').address
    }
    return { ok: true, json: async () => answer }
  }
}

afterEach(() => {
  delete (globalThis as any).fetch
})

test('#371: a resolved address answers the point AND the label, and nothing else', async () => {
  const spy: { address?: string; url?: string } = {}
  stubFetch(
    { result: { lat: -22.7469, lng: -41.8817, formattedAddress: 'R. das Pedras, Búzios - RJ' } },
    spy
  )

  const found = await geocodeAddress('  R. das Pedras, 100, Búzios  ')
  assert.deepEqual(found, {
    lat: -22.7469,
    lng: -41.8817,
    formattedAddress: 'R. das Pedras, Búzios - RJ',
  })
  // Trimmed before it leaves: `formatted_address` comes from a form somebody typed by hand.
  assert.equal(spy.address, 'R. das Pedras, 100, Búzios')
  // Pela NOSSA rota: a chave da Google não sai do servidor, e a busca responde a um `withAuth`.
  assert.equal(spy.url, GEOCODE_ENDPOINT)
})

test('#371 item 3: nada encontrado é null, não é exceção — nada bloqueia', async () => {
  stubFetch({ result: null })
  assert.equal(await geocodeAddress('Rua que não existe, 0'), null)
})

test('#371: an empty address never reaches Google', async () => {
  const spy: { address?: string } = {}
  stubFetch({ result: { lat: 0, lng: 0, formattedAddress: 'nowhere' } }, spy)

  assert.equal(await geocodeAddress(''), null)
  assert.equal(await geocodeAddress('   '), null)
  assert.equal(spy.address, undefined, 'a blank address is not a request')
})

test('#371: a rota falhando é null, e não pendura a tela', async () => {
  ;(globalThis as any).fetch = async () => {
    throw new Error('network down')
  }
  assert.equal(await geocodeAddress('Búzios', { timeoutMs: 150 }), null)

  ;(globalThis as any).fetch = async () => ({ ok: false, json: async () => ({}) })
  assert.equal(await geocodeAddress('Búzios'), null)
})

test('#409: a Geocoding API está negada nesta chave, e nada volta a chamá-la', () => {
  // Medido em 2026-08-23: `maps/api/geocode` responde `REQUEST_DENIED`, e a documentação da
  // Google diz que `google.maps.Geocoder` do SDK exige essa mesma API. Um commit que volte a
  // qualquer um dos dois traz de volta a falha silenciosa que o #371 deixou em produção.
  const client = code('lib/maps/geocode-address.ts')
  assert.equal(client.indexOf('google.maps.Geocoder'), -1)
  assert.equal(client.indexOf('new google.maps'), -1)
  assert.match(client, /GEOCODE_ENDPOINT = '\/api\/maps\/geocode'/)

  const route = code('app/api/maps/geocode/route.ts')
  assert.match(route, /places\.googleapis\.com\/v1\/places:searchText/)
  assert.equal(route.indexOf('maps/api/geocode'), -1)
  // A chave fica no servidor, atrás de autenticação e de rate limit.
  assert.match(route, /withAuth\(\{ roles: \['admin', 'editor'\] \}/)
  assert.match(route, /withRateLimit\(/)
})

// ── The negative guarantee, where a future commit would break it ─────────────────────────────

test('#371: the picker writes NO coordinate — só GESTO no mapa chama `onChange`', () => {
  const source = code(PICKER)

  // ERAM UM CHAMADOR, SÃO DOIS DESDE #409, e a garantia é a mesma: a geocodificação não vira
  // coordenada. Clicar diz a quadra; arrastar acerta a fachada, que fica a poucos metros dali —
  // e repetir cliques até acertar é mirar sem ver o que se move. Os dois são a mão do operador
  // sobre o mapa, que é exatamente o que a decisão de 2026-08-17 exige.
  const calls = source.match(/onChange\?\.\(/g) ?? []
  assert.equal(calls.length, 2, 'dois chamadores, e os dois são gesto humano no mapa')
  assert.match(source, /onMapClick=\{\(lat: number, lng: number\) => onChange\?\.\(lat, lng\)\}/)
  assert.match(
    source,
    /onMarkerDragEnd=\{\(_id: string, lat: number, lng: number\) => onChange\?\.\(lat, lng\)\}/
  )

  // E o pino só arrasta em modo de edição: num mapa de leitura ele seria dado alterado por
  // acidente, com aparência de verdade.
  assert.match(source, /draggable: editable/)

  // The geocoding result reaches `setGeocoded` and nothing else. The effect that geocodes is read
  // on its own: if `onChange` ever appeared inside it, the form would hold a coordinate nobody
  // chose and `handleSave` would write it.
  assert.match(source, /setGeocoded\(\{ lat: result\.lat, lng: result\.lng \}\)/)
  const effect = source.slice(source.indexOf('useEffect('), source.indexOf('if (!editable)'))
  assert.match(effect, /geocodeAddress\(/, 'the geocoding is in this block')
  assert.equal(effect.indexOf('onChange'), -1, 'and nothing in it touches the coordinate')
})

test('#371: the picker cannot reach the coordinate writer at all', () => {
  const source = code(PICKER)

  // Not a denylist over a patch object — there is no import through which the write could be
  // made. `cms_set_attraction_coordinate` has exactly one caller in the CMS.
  for (const forbidden of ['place-service', 'placeService', 'cms_set_attraction_coordinate', 'fetch(']) {
    assert.equal(source.indexOf(forbidden), -1, `the picker must not reach ${forbidden}`)
  }

  // Two callers of the RPC, one per entity, and each one is reached from a save the operator
  // asked for: the place's (`placeService.setCoordinate`, called by `PlaceFormModal.handleSave`)
  // and the event's. Neither is reachable from the geocoding.
  assert.deepEqual(grepRepo('cms_set_attraction_coordinate'), [
    'lib/core/event-service.ts',
    'lib/core/place-service.ts',
  ])
})

test('#371 · CLAUDE.md §6: there is ONE forward geocoder in the CMS', () => {
  // O SDK saiu em 2026-08-23 (#409): `google.maps.Geocoder` exige a Geocoding API, negada nesta
  // chave. A garantia de dono único não mudou — mudou quem é o dono. Reverse geocoding
  // (latlng → endereço) é outra pergunta, com módulos próprios, e não é contada aqui.
  assert.deepEqual(grepRepo('new google.maps.Geocoder('), [])
  assert.deepEqual(grepRepo('places:searchText'), ['app/api/maps/geocode/route.ts'])

  // E os dois chamadores passam pelo módulo, que é quem fala com a rota.
  assert.match(code('lib/hooks/use-map-state.ts'), /geocodeAddress\(cityQuery\)/)
  assert.match(code(PICKER), /geocodeAddress\(/)
})

test('#371: the modal hands the address down, and the address comes from the record', () => {
  const modal = code('components/place-management/PlaceFormModal.tsx')
  assert.match(modal, /address=\{details\?\.formatted_address \?\? null\}/)
  // Translated by the caller: this picker is used under more than one namespace, and a missing
  // one renders the key name.
  // Four captions and not one: without a coordinate there is always a legend, and the form of it
  // depends on what the geocoding answered (#371, item 1).
  assert.match(modal, /captions=\{\{/)
  assert.match(modal, /centered: t\('address_centered'\)/)

  // `core.get_place_details` does not return the column, so the service reads it — the widening
  // of the RPC is a requirement written back to the `data` on the card.
  const service = code('lib/core/place-service.ts')
  assert.match(service, /getFormattedAddress/)
  assert.match(service, /formatted_address: await placeService\.getFormattedAddress\(id\)/)
})

test('#371: the four captions exist in the three locales, so no screen prints the key name', () => {
  const keys = ['address_centered', 'address_locating', 'address_not_located', 'address_missing']

  for (const locale of ['pt', 'en', 'es']) {
    const messages = JSON.parse(read(`messages/${locale}.json`))
    for (const key of keys) {
      const caption = messages.Modals?.PlaceDetails?.[key]
      assert.equal(typeof caption, 'string', `${locale} is missing Modals.PlaceDetails.${key}`)
      assert.equal(caption.trim().length > 0, true, `${locale}.${key} is empty`)
    }
  }
})

/** Every file under the CMS's own source that contains `needle`, as repo-relative paths. */
function grepRepo(needle: string): string[] {
  const roots = ['app', 'components', 'lib', 'constants', 'hooks']
  const found: string[] = []

  function walk(dir: string) {
    for (const entry of readdirSync(join(REPO_ROOT, dir))) {
      const relative = join(dir, entry)
      const full = join(REPO_ROOT, relative)
      if (statSync(full).isDirectory()) {
        walk(relative)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue
      // The comments are stripped: three modules EXPLAIN the coordinate writer at length, and a
      // ruler that counts prose counts the wrong thing.
      if (code(relative).indexOf(needle) >= 0) found.push(relative)
    }
  }

  for (const root of roots) {
    try {
      walk(root)
    } catch {
      // A root that does not exist in this repo is not a failure of this assertion.
    }
  }
  return found.sort()
}

// ── The click that writes the coordinate, and the fields it fills ────────────────────────────

test('the picker map never opens in drawing mode — otherwise the click drops a vertex', () => {
  const picker = code(PICKER)

  // `GoogleMapComponent` defaults both to `true`, and while a polygon is being drawn its click
  // listener returns BEFORE calling `onMapClick`. That is exactly how place creation reached a
  // form with name/city/country filled, no coordinate, and a message blaming the filled fields.
  assert.match(picker, /enableDrawing=\{false\}/)
  assert.match(picker, /showDrawingButton=\{false\}/)

  const map = code('components/ui/GoogleMapComponent.tsx')
  assert.match(map, /if \(drawerRef\.current\?\.isDrawing\(\)\) return/)
})

test('the missing-field message names what is missing, coordinate included', async () => {
  const { IDENTITY_REQUIRED_FIELDS, missingRequiredLabels } =
    await import('@/lib/core/entity-form-validation')

  // The reported case: everything typed, nothing clicked on the map.
  assert.deepEqual(
    missingRequiredLabels({ name: 'Telhanorte', city: 'Bragança Paulista', country: 'Brazil' }),
    ['location'],
  )

  // Latitude alone is not a location: half a pair writes a coordinate in the ocean.
  assert.deepEqual(
    missingRequiredLabels({ name: 'X', city: 'Y', country: 'Z', latitude: -22.9, longitude: '' }),
    ['location'],
  )

  assert.deepEqual(
    missingRequiredLabels({ name: 'X', city: 'Y', country: 'Z', latitude: -22.9, longitude: -43.2 }),
    [],
  )

  // Nothing filled: every group is reported, in the order of the form.
  assert.deepEqual(missingRequiredLabels({}), ['name', 'city', 'country', 'location'])

  // The event modal adds its own group on creation, and it is reported the same way.
  const withStart = [...IDENTITY_REQUIRED_FIELDS, { label: 'starts_at', keys: ['starts_at'] }]
  assert.deepEqual(
    missingRequiredLabels({ name: 'X', city: 'Y', country: 'Z', latitude: 1, longitude: 2 }, withStart),
    ['starts_at'],
  )
})

test('both form modals report missing fields by name, and the label of each exists', () => {
  for (const modal of [
    'components/place-management/PlaceFormModal.tsx',
    'components/event-management/EventFormModal.tsx',
  ]) {
    const source = code(modal)
    assert.match(source, /missingRequiredLabels/, `${modal} still uses a fixed sentence`)
    assert.equal(source.includes("t('validation_required')"), false, `${modal} keeps the old message`)
  }

  for (const locale of ['pt', 'en', 'es']) {
    const messages = JSON.parse(read(`messages/${locale}.json`))
    for (const namespace of ['PlaceDetails', 'EventDetails']) {
      const node = messages.Modals?.[namespace]
      const message = node?.validation_missing
      assert.equal(typeof message, 'string', `${locale} is missing Modals.${namespace}.validation_missing`)
      assert.match(message, /\{fields\}/, `${locale}.${namespace}.validation_missing drops the list`)
      // Every group's label is what the message interpolates: a missing one prints the key.
      for (const label of ['name', 'city', 'country', 'location', 'starts_at']) {
        if (namespace === 'PlaceDetails' && label === 'starts_at') continue
        assert.equal(typeof node?.labels?.[label], 'string', `${locale}.${namespace}.labels.${label}`)
      }
    }
  }
})

test('the click fills city/state/country, and only on creation', () => {
  const hook = code('lib/hooks/use-reverse-geocode.ts')

  // Same endpoint as POI creation (SSOT for the Nominatim lookup), not a second geocoder.
  assert.match(hook, /'\/api\/pois\/reverse-geocode'/)
  // Nominatim answers "Brasil"/"State of São Paulo"; the base stores the canonical English form.
  assert.match(hook, /normalizeLocation/)
  // The hook never writes a coordinate: it only reads one. The human click stays the sole writer.
  assert.equal(hook.includes('setCoordinate'), false)

  for (const modal of [
    'components/place-management/PlaceFormModal.tsx',
    'components/event-management/EventFormModal.tsx',
  ]) {
    const source = code(modal)
    assert.match(source, /useReverseGeocode\(\{/, `${modal} does not detect the location`)
    // Create mode only: on an existing record those three fields were curated by someone.
    assert.match(source, /enabled: isOpen && !isEdit && canEdit/, `${modal} would overwrite curated fields`)
  }
})

test('the detected-location lookup stays the only reverse geocoder in the CMS client', () => {
  // `lib/roles.ts` names the route in its permission table without calling it — the ruler is
  // the fetch, not the string.
  const callers = grepRepo("fetch('/api/pois/reverse-geocode'")
  assert.deepEqual(
    callers,
    ['components/poi-management/POIDetailsModal.tsx', 'lib/hooks/use-reverse-geocode.ts'],
    'a third reverse geocoder appeared — fold it into use-reverse-geocode',
  )
})

// ── Publicação: onde os três controles moram ─────────────────────────────────────────────────

test('publishing lives in the sidebar, and only where the Save button also is', () => {
  const drawer = code('components/entity-management/EntityManagementDrawer.tsx')

  // The slot is in the <aside>, pinned to the bottom.
  assert.match(drawer, /sidebarFooter && activeTab === 'details'/)
  assert.match(drawer, /<div className="mt-auto">\{sidebarFooter\}<\/div>/)

  // The footer with Save is rendered under the same condition. Splitting them would let the
  // operator tick `Approved` on a tab with no way to persist it, and lose it on close.
  assert.match(drawer, /\{activeTab === 'details' && \(\s*<footer/)

  for (const modal of [
    'components/place-management/PlaceFormModal.tsx',
    'components/event-management/EventFormModal.tsx',
  ]) {
    const source = code(modal)
    assert.match(source, /sidebarFooter=\{isEdit \? \(/, `${modal} does not fill the sidebar slot`)
    assert.match(source, /<PublishingControls/, `${modal} rebuilt the controls by hand`)
    // The old home: the bottom of the Details form, below Identity/Commerce/Amenities.
    assert.equal(
      source.includes("<h4 className={sectionTitle}><Send"),
      false,
      `${modal} still renders a Publishing section inside the form`,
    )
  }
})
