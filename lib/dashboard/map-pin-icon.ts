/**
 * The pixels of a map pin: the SVG that `components/ui/GoogleMapComponent.tsx` hands to
 * `google.maps.Marker` as a data URI.
 *
 * It lives outside the component because it is the only place where the three channels of
 * `lib/dashboard/map-pin.ts` become geometry, and because a `google.maps` namespace is not
 * needed to decide any of it — these are pure strings. `buildIcon` keeps the `scaledSize` and
 * `anchor` wiring, which is the only part that needs the Maps SDK loaded.
 *
 * Two rules are drawn here, not decided here:
 *
 * - **DS-MAPA-027** — emphasis for "the guide is on" is static: size (32 vs. 24), a halo of
 *   the pin's own hue, a white outline and `zIndex`. No animation loop. `Animation.BOUNCE` was
 *   here until #732 and came out: it is perpetual by specification (it runs until `animation`
 *   is explicitly set to `null`), it has no pause affordance, and it moves the marker off the
 *   very coordinate the map exists to state.
 * - **DS-MAPA-028** — an archived position is the **hollow** pin: same `d`, same size, same
 *   anchor, white fill, and the entitlement colour at **full strength** in the stroke. It was
 *   45 % opacity until #732, which dropped the orange from 2,47:1 to 1,54:1 over the default
 *   land tile and stopped the three entitlement states from being told apart at all — opacity
 *   is the one channel that destroys the other channel.
 */

/** The teardrop of the base pin. The hollow pin **must** reuse it, or shape stops being one channel. */
export const PIN_PATH_D =
  'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z'

/**
 * Size and anchor per state. The active pin is centred (16,16) because it is a disc; the base
 * pin hangs from its tip (12,24). Filled and hollow share a row on purpose: the shape channel
 * must not leak into the size channel, which belongs to the guide being on.
 */
export const PIN_GEOMETRY = {
  active: { size: 32, anchor: { x: 16, y: 16 } },
  base: { size: 24, anchor: { x: 12, y: 24 } },
} as const

/** The white the hollow pin is filled with, so it reads as a pin and not as a hole in the map. */
const HOLLOW_FILL = '#ffffff'

/**
 * The SVG of a pin, as a string.
 *
 * `active` and `dimmed` never arrive true together — `userPinAppearance` guarantees it (the
 * guide being on is presence the database declared, so it is never archive). Should a future
 * caller break that, emphasis wins: the guide being on is the fact the operator is looking for.
 */
export function pinSvg(color: string, opts: { active?: boolean; dimmed?: boolean } = {}): string {
  if (opts.active === true) {
    const { size } = PIN_GEOMETRY.active
    return `
        <svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
          <circle cx="16" cy="16" r="13" fill="${color}" fill-opacity="0.25"/>
          <circle cx="16" cy="16" r="7" fill="${color}" stroke="#ffffff" stroke-width="2.5"/>
        </svg>`
  }

  const { size } = PIN_GEOMETRY.base
  const fill =
    opts.dimmed === true
      ? `fill="${HOLLOW_FILL}" fill-opacity="0.9" stroke="${color}" stroke-width="1.6"`
      : `fill="${color}"`

  return `
        <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="${PIN_PATH_D}" ${fill}/>
        </svg>`
}
