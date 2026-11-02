// A Day is a local calendar date, 'YYYY-MM-DD'. Tasks store days, not
// timestamps, so a date never shifts with the time zone.

export type Day = string

const pad = (n: number) => String(n).padStart(2, '0')

export function dayKey(date: Date): Day {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Local midnight of a day. */
export function parseDay(day: Day): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

export function addDays(day: Day, n: number): Day {
  const date = parseDay(day)
  date.setDate(date.getDate() + n)
  return dayKey(date)
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function daysBetween(a: Day, b: Day): number {
  // Noon avoids DST days that are 23 or 25 hours long.
  const ms = (day: Day) => parseDay(day).getTime() + 12 * 3_600_000
  return Math.round((ms(b) - ms(a)) / 86_400_000)
}

/** 0 = Sunday, like Date#getDay. */
export function weekday(day: Day): number {
  return parseDay(day).getDay()
}

export function today(now: Date = new Date()): Day {
  return dayKey(now)
}

export function isDay(value: unknown): value is Day {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}
