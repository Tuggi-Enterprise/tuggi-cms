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
 *  · a second forward geocoder anywhere in the CMS.
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
  pickLocationPickerView,
} from '@/lib/maps/location-picker-view'
import { geocodeAddress, waitForGoogleMaps } from '@/lib/maps/geocode-address'

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

// ── The geocoding itself ─────────────────────────────────────────────────────────────────────

interface FakeGeocode {
  status: string
  results: unknown[]
}

function stubGoogle(answer: FakeGeocode, spy?: { address?: string }) {
  ;(globalThis as any).window = globalThis
  ;(globalThis as any).google = {
    maps: {
      Geocoder: class {
        geocode(request: { address: string }, callback: (results: unknown[] | null, status: string) => void) {
          if (spy) spy.address = request.address
          callback(answer.results, answer.status)
        }
      },
    },
  }
}

function googleResult(lat: number, lng: number, formatted: string) {
  return {
    geometry: { location: { lat: () => lat, lng: () => lng } },
    formatted_address: formatted,
  }
}

afterEach(() => {
  delete (globalThis as any).google
  delete (globalThis as any).window
})

test('#371: a resolved address answers the point AND the label, and nothing else', async () => {
  const spy: { address?: string } = {}
  stubGoogle(
    { status: 'OK', results: [googleResult(-22.7469, -41.8817, 'R. das Pedras, Búzios - RJ')] },
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
})

test('#371 item 3: `ZERO_RESULTS` is null, not an exception — nothing blocks', async () => {
  stubGoogle({ status: 'ZERO_RESULTS', results: [] })
  assert.equal(await geocodeAddress('Rua que não existe, 0'), null)
})

test('#371: an empty address never reaches Google', async () => {
  const spy: { address?: string } = {}
  stubGoogle({ status: 'OK', results: [googleResult(0, 0, 'nowhere')] }, spy)

  assert.equal(await geocodeAddress(''), null)
  assert.equal(await geocodeAddress('   '), null)
  assert.equal(spy.address, undefined, 'a blank address is not a request')
})

test('#371: the SDK never loading is null, and it does not hang the screen', async () => {
  ;(globalThis as any).window = globalThis
  assert.equal(await waitForGoogleMaps(150), false)
  assert.equal(await geocodeAddress('Búzios', { timeoutMs: 150 }), null)
})

// ── The negative guarantee, where a future commit would break it ─────────────────────────────

test('#371: the picker writes NO coordinate — `onChange` has exactly one caller, the map click', () => {
  const source = code(PICKER)

  const calls = source.match(/onChange\?\.\(/g) ?? []
  assert.equal(calls.length, 1, 'one caller, and it is `onMapClick`')
  assert.match(source, /onMapClick=\{\(lat: number, lng: number\) => onChange\?\.\(lat, lng\)\}/)

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
  // `new google.maps.Geocoder()` is the forward geocoding of the Maps JS SDK. Reverse geocoding
  // (latlng → address) is a different question with its own modules and is not counted here.
  const geocoders = grepRepo('new google.maps.Geocoder(')
  assert.deepEqual(geocoders, ['lib/maps/geocode-address.ts'])

  // And the caller that used to own it goes through the module now.
  assert.match(code('lib/hooks/use-map-state.ts'), /geocodeAddress\(cityQuery\)/)
})

test('#371: the modal hands the address down, and the address comes from the record', () => {
  const modal = code('components/place-management/PlaceFormModal.tsx')
  assert.match(modal, /address=\{details\?\.formatted_address \?\? null\}/)
  // Translated by the caller: this picker is used under more than one namespace, and a missing
  // one renders the key name.
  assert.match(modal, /addressCaption=\{t\('address_centered'\)\}/)

  // `core.get_place_details` does not return the column, so the service reads it — the widening
  // of the RPC is a requirement written back to the `data` on the card.
  const service = code('lib/core/place-service.ts')
  assert.match(service, /getFormattedAddress/)
  assert.match(service, /formatted_address: await placeService\.getFormattedAddress\(id\)/)
})

test('#371: the caption exists in the three locales, so no screen prints the key name', () => {
  for (const locale of ['pt', 'en', 'es']) {
    const messages = JSON.parse(read(`messages/${locale}.json`))
    const caption = messages.Modals?.PlaceDetails?.address_centered
    assert.equal(typeof caption, 'string', `${locale} is missing Modals.PlaceDetails.address_centered`)
    assert.equal(caption.length > 0, true)
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
