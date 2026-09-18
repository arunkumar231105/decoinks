/**
 * How Printshop writes a date and a time, everywhere (the owner, 18 Sep 2026):
 * "18 Sep 2026" — day, short month in words, year — and "3:30 PM".
 *
 * The month names are spelled out here rather than taken from the browser's
 * locale data, which in some browsers writes September as "Sept".
 *
 * A bare calendar day ("2026-09-18") is that day wherever the viewer is, never
 * shifted by a time zone; a timestamp is shown in the viewer's time, or in the
 * zone given.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

type Parts = { y: number; m: number; d: number; wd: number; h: number; min: number; hasTime: boolean }

function parts(value: unknown, timeZone?: string): Parts | null {
  if (value === null || value === undefined || value === '') return null
  const raw = value instanceof Date ? value : String(value).trim()
  if (typeof raw === 'string') {
    const day = DAY_ONLY.exec(raw)
    if (day) {
      const y = Number(day[1]), m = Number(day[2]) - 1, d = Number(day[3])
      return { y, m, d, wd: new Date(Date.UTC(y, m, d)).getUTCDay(), h: 0, min: 0, hasTime: false }
    }
  }
  const dt = raw instanceof Date ? raw : new Date(raw)
  if (Number.isNaN(dt.getTime())) return null
  if (!timeZone) {
    return { y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate(), wd: dt.getDay(), h: dt.getHours(), min: dt.getMinutes(), hasTime: true }
  }
  const p: Record<string, string> = {}
  for (const x of new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(dt)) p[x.type] = x.value
  return {
    y: Number(p.year), m: Number(p.month) - 1, d: Number(p.day), wd: WEEKDAYS.indexOf(p.weekday),
    h: Number(p.hour) % 24, min: Number(p.minute), hasTime: true,
  }
}

/** "18 Sep 2026". */
export function fmtDate(value: unknown, fallback = '—', timeZone?: string): string {
  const p = parts(value, timeZone)
  return p ? `${p.d} ${MONTHS[p.m]} ${p.y}` : fallback
}

/** "18 Sep" — for charts and lists where the year is plain. */
export function fmtDayMonth(value: unknown, fallback = '—', timeZone?: string): string {
  const p = parts(value, timeZone)
  return p ? `${p.d} ${MONTHS[p.m]}` : fallback
}

/** "Fri, 18 Sep 2026". */
export function fmtWeekdayDate(value: unknown, fallback = '—', timeZone?: string): string {
  const p = parts(value, timeZone)
  return p ? `${WEEKDAYS[p.wd]}, ${p.d} ${MONTHS[p.m]} ${p.y}` : fallback
}

/** "3:30 PM" — empty for a bare calendar day, which has no time. */
export function fmtTime(value: unknown, fallback = '', timeZone?: string): string {
  const p = parts(value, timeZone)
  if (!p || !p.hasTime) return fallback
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12
  return `${h12}:${String(p.min).padStart(2, '0')} ${p.h < 12 ? 'AM' : 'PM'}`
}

/** "18 Sep 2026, 3:30 PM" — or just the day when there is no time. */
export function fmtDateTime(value: unknown, fallback = '—', timeZone?: string): string {
  const day = fmtDate(value, '', timeZone)
  if (!day) return fallback
  const time = fmtTime(value, '', timeZone)
  return time ? `${day}, ${time}` : day
}
