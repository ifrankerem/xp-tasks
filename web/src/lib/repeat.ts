// How a task repeats. One pure module for the calendar, the list text and the
// alarms; the native alarm code ports it and must pass the same cases.
//
// Every rule counts from an anchor day (the task's date, or the day it was
// created) and never occurs before it.

import { addDays, daysBetween, parseDay, weekday, type Day } from './day'

export type RepeatRule =
  | { kind: 'daily'; interval: number }
  | { kind: 'weekly'; days: readonly number[]; interval: number } // days: 0 = Sunday
  | { kind: 'monthly'; dayOfMonth: number }

const LEGACY_DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

const interval = (v: unknown) => {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 52) : 1
}

const weekdays = (v: unknown): number[] =>
  Array.isArray(v)
    ? [...new Set(v.map((d) => Math.trunc(Number(d))).filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b)
    : []

/**
 * A clean rule from untrusted data (server JSON, backups, v1 records), or null
 * for "does not repeat". `legacy` is v1's "Mon, Wed, Fri" string, used only
 * when there is no structured rule.
 */
export function normalizeRule(raw: unknown, legacy?: string | null): RepeatRule | null {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    if (r.kind === 'daily') return { kind: 'daily', interval: interval(r.interval) }
    if (r.kind === 'weekly') {
      const days = weekdays(r.days)
      if (days.length) return { kind: 'weekly', days, interval: interval(r.interval) }
    }
    if (r.kind === 'monthly') {
      const dayOfMonth = Math.trunc(Number(r.dayOfMonth))
      if (dayOfMonth >= 1 && dayOfMonth <= 31) return { kind: 'monthly', dayOfMonth }
    }
    if (r.kind) return null
  }
  const days = weekdays((legacy ?? '').split(',').map((s) => LEGACY_DAYS[s.trim()] ?? -1))
  return days.length ? { kind: 'weekly', days, interval: 1 } : null
}

/** Monday of the week `day` is in. */
const mondayOf = (day: Day) => addDays(day, -((weekday(day) + 6) % 7))

export function occursOn(rule: RepeatRule, anchor: Day, day: Day): boolean {
  const elapsed = daysBetween(anchor, day)
  if (elapsed < 0) return false
  switch (rule.kind) {
    case 'daily':
      return elapsed % rule.interval === 0
    case 'weekly': {
      if (!rule.days.includes(weekday(day))) return false
      const weeks = Math.floor(daysBetween(mondayOf(anchor), day) / 7)
      return weeks % rule.interval === 0
    }
    case 'monthly': {
      const date = parseDay(day)
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
      return date.getDate() === Math.min(rule.dayOfMonth, lastDay)
    }
  }
}

/** First occurrence on or after `from`. Every valid rule has one within 53 weeks. */
export function nextOccurrence(rule: RepeatRule, anchor: Day, from: Day): Day | null {
  let day = daysBetween(anchor, from) < 0 ? anchor : from
  for (let i = 0; i <= 380; i++, day = addDays(day, 1)) {
    if (occursOn(rule, anchor, day)) return day
  }
  return null
}
