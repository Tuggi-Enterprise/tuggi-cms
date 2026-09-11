/**
 * One row of a map legend, shared by the two maps that plot tourists — the Overview hero map
 * and the geography report.
 *
 * It was declared twice, identically, in `app/[locale]/dashboard/page.tsx` and in
 * `components/dashboard/reports/GeoDemand.tsx`. #732 gave the pin two channels that are not
 * colour, and a second copy of the swatch would have been a second place to get them wrong.
 *
 * `ring` and `dim` are those channels: the guide being on is the big pin with a halo, and an
 * archived position is the half opacity (`components/ui/GoogleMapComponent.tsx`, `buildIcon`).
 * A solid dot for either would claim there is a "guide" colour and an "archived" colour, and
 * there is neither.
 */
export function MapLegendItem({ color, label, pulse, ring, dim }: {
  color: string
  label: string
  pulse?: boolean
  ring?: boolean
  dim?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`w-2.5 h-2.5 rounded-full shrink-0 ${pulse ? 'animate-pulse' : ''}`}
        style={
          ring
            ? { backgroundColor: color, boxShadow: `0 0 0 3px ${color}40` }
            : { backgroundColor: color, opacity: dim ? 0.45 : 1 }
        }
      />
      <span className="text-[10px] font-black uppercase tracking-tight text-gray-600 dark:text-gray-300">{label}</span>
    </div>
  )
}
