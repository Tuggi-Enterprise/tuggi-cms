/**
 * One row of a map legend, shared by the two maps that plot tourists — the Overview hero map
 * and the geography report.
 *
 * It was declared twice, identically, in `app/[locale]/dashboard/page.tsx` and in
 * `components/dashboard/reports/GeoDemand.tsx`. #732 gave the pin two channels that are not
 * colour, and a second copy of the swatch would have been a second place to get them wrong.
 *
 * `ring` and `dim` are those channels: the guide being on is the big pin with a halo, and an
 * archived position is the **hollow** pin (`lib/dashboard/map-pin-icon.ts`, `pinSvg`). A solid
 * dot for either would claim there is a "guide" colour and an "archived" colour, and there is
 * neither.
 *
 * **The legend never animates what the map does not animate** (DS-MAPA-027). There was a
 * `pulse` prop here, pulsing the green sample while the green pin (`livePinAppearance`) is
 * `active: false` — a still pin. A legend that moves while the map stands still is a broken
 * contract, so the prop is gone rather than unused.
 *
 * And the `dim` sample mirrors the pin instead of fading (DS-MAPA-028): a 10 px square at
 * 45 % over the white pill of the legend is a key nobody can read.
 */
export function MapLegendItem({ color, label, ring, dim }: {
  color: string
  label: string
  ring?: boolean
  dim?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={
          ring
            ? { backgroundColor: color, boxShadow: `0 0 0 3px ${color}40` }
            : dim
              ? { backgroundColor: '#ffffff', boxShadow: `inset 0 0 0 2px ${color}` }
              : { backgroundColor: color }
        }
      />
      <span className="text-[10px] font-black uppercase tracking-tight text-gray-600 dark:text-gray-300">{label}</span>
    </div>
  )
}
