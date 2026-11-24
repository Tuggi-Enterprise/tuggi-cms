/**
 * The legend over a dashboard map: a dot and a short label per pin kind.
 *
 * Moved out of the Overview page in #1266 so the Radar shows the same legend for the live pins.
 * It does not catch the pointer, so the map under it stays draggable.
 */

export interface MapLegendEntry {
  color: string
  label: string
  /** Pulsing dot, for pins that are live now. */
  pulse?: boolean
}

export function MapLegend({ items, className = '' }: { items: MapLegendEntry[]; className?: string }) {
  return (
    <div
      className={`absolute bottom-3 left-3 z-10 flex flex-col gap-1.5 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2 shadow-sm pointer-events-none ${className}`}
    >
      {items.map(item => (
        <div key={item.label} className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${item.pulse ? 'animate-pulse' : ''}`}
            style={{ backgroundColor: item.color }}
          />
          <span className="text-[10px] font-black uppercase tracking-tight text-gray-600 dark:text-gray-300">{item.label}</span>
        </div>
      ))}
    </div>
  )
}
