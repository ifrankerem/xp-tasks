import { describe, expect, it } from 'vitest'
import { calendarState, monthDays, shiftMonth } from '../src/lib/calendar'

describe('calendar URL state', () => {
  const now = new Date(2026, 10, 3, 23, 45)
  it('defaults to the local current month and day', () => {
    expect(calendarState('', now)).toEqual({ month: '2026-11', day: '2026-11-03' })
  })
  it('keeps the displayed month independent from the selected day', () => {
    expect(calendarState('ay=2026-12&gun=2026-11-14', now)).toEqual({
      month: '2026-12',
      day: '2026-11-14',
    })
  })
  it('uses a valid selected day as the default month', () => {
    expect(calendarState('gun=2027-01-09', now)).toEqual({ month: '2027-01', day: '2027-01-09' })
  })
  it.each(['ay=2026-13&gun=2026-02-30', 'ay=bad&gun=2026-11-31', 'ay=999999-12&gun=bad'])(
    'rejects impossible URL values: %s',
    (query) => {
      expect(calendarState(query, now)).toEqual({ month: '2026-11', day: '2026-11-03' })
    },
  )
})

describe('month grid', () => {
  it('includes every day in complete Monday-first weeks', () => {
    const days = monthDays('2026-11')
    expect(days).toHaveLength(42)
    expect(days[0]).toBe('2026-10-26')
    expect(days.at(-1)).toBe('2026-12-06')
    expect(days.filter((day) => day.startsWith('2026-11'))).toHaveLength(30)
    expect(new Set(days).size).toBe(days.length)
  })
  it('handles leap February and months starting on Monday', () => {
    expect(monthDays('2028-02')).toContain('2028-02-29')
    expect(monthDays('2027-02')).toHaveLength(28)
    expect(monthDays('2027-02')[0]).toBe('2027-02-01')
  })
  it('crosses year boundaries without overflowing the day of month', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2027-01', -1)).toBe('2026-12')
    expect(shiftMonth('2026-01', 1)).toBe('2026-02')
  })
})
