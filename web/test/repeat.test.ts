import { describe, expect, it } from 'vitest'
import { addDays, dayKey, daysBetween, parseDay, weekday } from '../src/lib/day'
import { nextOccurrence, normalizeRule, occursOn } from '../src/lib/repeat'

describe('day', () => {
  it('round-trips local days', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(parseDay('2026-03-29').getHours()).toBe(0)
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3)
    expect(weekday('2026-11-02')).toBe(1) // Monday
  })
})

describe('occursOn', () => {
  it('daily every 2 days counts from the anchor, never before it', () => {
    const rule = { kind: 'daily', interval: 2 } as const
    expect(occursOn(rule, '2026-11-02', '2026-11-02')).toBe(true)
    expect(occursOn(rule, '2026-11-02', '2026-11-03')).toBe(false)
    expect(occursOn(rule, '2026-11-02', '2026-11-04')).toBe(true)
    expect(occursOn(rule, '2026-11-02', '2026-10-31')).toBe(false)
  })

  it('weekly every 2 weeks uses Monday-first weeks from the anchor week', () => {
    // Anchor Wed 2026-11-04; Mon + Sun selected.
    const rule = { kind: 'weekly', days: [1, 0], interval: 2 } as const
    expect(occursOn(rule, '2026-11-04', '2026-11-08')).toBe(true) // Sun, same Mon-first week
    expect(occursOn(rule, '2026-11-04', '2026-11-09')).toBe(false) // Mon, next week
    expect(occursOn(rule, '2026-11-04', '2026-11-16')).toBe(true) // Mon, two weeks on
    expect(occursOn(rule, '2026-11-04', '2026-11-02')).toBe(false) // Mon before the anchor
  })

  it('monthly clamps to the last day of short months', () => {
    const rule = { kind: 'monthly', dayOfMonth: 31 } as const
    expect(occursOn(rule, '2026-01-31', '2026-02-28')).toBe(true)
    expect(occursOn(rule, '2026-01-31', '2026-04-30')).toBe(true)
    expect(occursOn(rule, '2026-01-31', '2026-04-29')).toBe(false)
  })
})

describe('nextOccurrence', () => {
  it('is inclusive of the start day', () => {
    const rule = { kind: 'weekly', days: [6], interval: 1 } as const // Saturdays
    expect(nextOccurrence(rule, '2026-11-01', '2026-11-07')).toBe('2026-11-07')
    expect(nextOccurrence(rule, '2026-11-01', '2026-11-08')).toBe('2026-11-14')
  })

  it('starts at the anchor when asked about earlier days', () => {
    expect(nextOccurrence({ kind: 'daily', interval: 3 }, '2026-12-01', '2026-11-01')).toBe('2026-12-01')
  })

  it('finds a far monthly day and long weekly intervals', () => {
    expect(nextOccurrence({ kind: 'monthly', dayOfMonth: 30 }, '2026-01-30', '2026-02-01')).toBe('2026-02-28')
    expect(nextOccurrence({ kind: 'weekly', days: [3], interval: 52 }, '2026-01-07', '2026-01-08')).toBe('2027-01-06')
  })
})

describe('normalizeRule', () => {
  it('accepts valid rules and cleans them', () => {
    expect(normalizeRule({ kind: 'weekly', days: [5, 1, 1, 9], interval: 0 })).toEqual({ kind: 'weekly', days: [1, 5], interval: 1 })
    expect(normalizeRule({ kind: 'daily', interval: 400 })).toEqual({ kind: 'daily', interval: 52 })
    expect(normalizeRule({ kind: 'monthly', dayOfMonth: 15 })).toEqual({ kind: 'monthly', dayOfMonth: 15 })
  })

  it('turns empty or broken rules into null', () => {
    expect(normalizeRule(null)).toBeNull()
    expect(normalizeRule({ kind: 'none' })).toBeNull()
    expect(normalizeRule({ kind: 'weekly', days: [] })).toBeNull()
    expect(normalizeRule({ kind: 'monthly', dayOfMonth: 32 })).toBeNull()
    expect(normalizeRule('Mon')).toBeNull()
  })

  it('reads the v1 legacy weekday string when there is no rule', () => {
    expect(normalizeRule(undefined, 'Mon, Wed, Fri')).toEqual({ kind: 'weekly', days: [1, 3, 5], interval: 1 })
    expect(normalizeRule(undefined, 'Sun, Mon, Tue, Wed, Thu, Fri, Sat')).toEqual({ kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], interval: 1 })
    expect(normalizeRule({ kind: 'daily', interval: 2 }, 'Mon')).toEqual({ kind: 'daily', interval: 2 })
  })
})
