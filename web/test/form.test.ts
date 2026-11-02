import { describe, expect, it } from 'vitest'
import { prepareTask } from '../src/lib/form'

describe('form values', () => {
  const now = new Date(2026, 10, 2, 18, 30)
  it('trims titles and refuses empty titles', () => {
    expect(prepareTask({ title: '  Süt al  ' }, now).title).toBe('Süt al')
    expect(() => prepareTask({ title: '  ' }, now)).toThrow()
  })
  it.each([
    ['18:31', '2026-11-02'],
    ['18:30', '2026-11-03'],
    ['08:00', '2026-11-03'],
  ])('fills the date for a one-off alarm at %s', (alarm, date) => {
    expect(prepareTask({ title: 'x', alarm }, now).date).toBe(date)
  })
  it('handles the local year boundary', () => {
    expect(prepareTask({ title: 'x', alarm: '00:05' }, new Date(2026, 11, 31, 23, 59)).date).toBe(
      '2027-01-01',
    )
  })
  it('keeps explicit dates and undated repeat anchors', () => {
    expect(prepareTask({ title: 'x', alarm: '08:00', date: '2026-11-10' }, now).date).toBe(
      '2026-11-10',
    )
    expect(
      prepareTask({ title: 'x', alarm: '08:00', repeat: { kind: 'daily', interval: 2 } }, now).date,
    ).toBeUndefined()
  })
  it('validates all repeat kinds instead of silently changing invalid values', () => {
    for (const repeat of [
      { kind: 'daily', interval: 2 },
      { kind: 'weekly', days: [1, 6], interval: 2 },
      { kind: 'monthly', dayOfMonth: 31 },
    ] as const) {
      expect(prepareTask({ title: 'x', repeat }, now).repeat).toEqual(repeat)
    }
    for (const repeat of [
      { kind: 'weekly', days: [], interval: 1 },
      { kind: 'daily', interval: 0 },
      { kind: 'daily', interval: 1.5 },
      { kind: 'monthly', dayOfMonth: 32 },
    ] as const) {
      expect(() => prepareTask({ title: 'x', repeat }, now)).toThrow()
    }
  })
  it('rejects invalid dates and clock times', () => {
    expect(() => prepareTask({ title: 'x', date: '2026-02-30' }, now)).toThrow()
    expect(() => prepareTask({ title: 'x', alarm: '25:00' }, now)).toThrow()
  })
})
