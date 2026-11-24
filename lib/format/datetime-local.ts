/**
 * The `<input type="datetime-local">` value and back, in the browser's zone (#1192, #1257). The value
 * goes out as ISO with the offset: an operator in Brazil who types 23:59 means 23:59 in Brazil, not
 * in UTC.
 */

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** ISO → the `datetime-local` value; empty for `null`. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** The `datetime-local` value → ISO with the zone; `null` when empty, the raw text when unreadable. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toISOString()
}
