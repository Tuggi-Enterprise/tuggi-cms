// _shared/events-text.ts
//
// Text and date helpers of the events import (#1075, #1077, BR-EVENTO-009): HTML to plain text, and a
// local wall time of a source's zone as ISO 8601 with that zone's offset. Pure, no import.

// ---------------------------------------------------------------------------------------------
// Text

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  ordm: 'º',
  ordf: 'ª',
  deg: '°',
  copy: '©',
  reg: '®',
  middot: '·',
  bull: '•',
  euro: '€',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const BLOCK_TAG = /<\/?(p|div|h[1-6]|ul|ol|li|blockquote|section|article|table|tr)\b[^>]*>/gi;

/** HTML to plain text: one paragraph per block, `\n` for `<br>`, no tag, entities decoded. */
export function htmlToText(html: string): string {
  const marked = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\u0001')
    .replace(/<li\b[^>]*>/gi, '\u0002• ')
    .replace(BLOCK_TAG, '\u0002')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(marked)
    .split('\u0002')
    .map((block) =>
      block
        .split('\u0001')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter((line) => line.length > 0)
        .join('\n')
    )
    .filter((block) => block.length > 0)
    .join('\n\n');
}

// ---------------------------------------------------------------------------------------------
// Dates

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** Offset of `timeZone` at the instant `ms`, in minutes east of UTC. */
export function offsetMinutes(timeZone: string, ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/**
 * The local wall time `day` + `time` in `timeZone`, as ISO 8601 with that zone's offset on that day
 * (`2026-11-06T00:00:00-03:00`). Throws on a value that does not start with a YYYY-MM-DD day.
 */
export function localIso(day: string, time: string, timeZone: string): string {
  const m = DAY.exec(day);
  if (!m) throw new Error(`invalid_date:${day}`);
  const [h, mi, s] = time.split(':').map(Number);
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, mi, s);
  // The offset at the wall time read as UTC is a guess; read it again at the instant it points to.
  const first = offsetMinutes(timeZone, wall);
  const offset = offsetMinutes(timeZone, wall - first * 60_000);
  return `${m[1]}-${m[2]}-${m[3]}T${time}${formatOffset(offset)}`;
}
