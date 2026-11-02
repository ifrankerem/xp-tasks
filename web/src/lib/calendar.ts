import { addDays, dayKey, isDay, parseDay, today, weekday, type Day } from './day'

export function validDay(value: string | null): value is Day {
  return isDay(value) && dayKey(parseDay(value)) === value
}

export function calendarState(query: string, now: Date) {
  const params = new URLSearchParams(query)
  const requestedDay = params.get('gun')
  const day = validDay(requestedDay) ? requestedDay : today(now)
  const month = params.get('ay') ?? ''
  return {
    month: /^\d{4}-\d{2}$/.test(month) && validDay(`${month}-01`) ? month : day.slice(0, 7),
    day,
  }
}

export function calendarPath(month: string, day: Day) {
  return `/takvim?ay=${month}&gun=${day}`
}

export function shiftMonth(month: string, delta: number) {
  const date = parseDay(`${month}-01`)
  date.setMonth(date.getMonth() + delta)
  const next = dayKey(date).slice(0, 7)
  return /^\d{4}-\d{2}$/.test(next) ? next : month
}

export function monthDays(month: string): Day[] {
  const first = `${month}-01`
  const date = parseDay(first)
  const count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  const offset = (weekday(first) + 6) % 7
  const start = addDays(first, -offset)
  return Array.from({ length: Math.ceil((count + offset) / 7) * 7 }, (_, index) =>
    addDays(start, index),
  )
}
