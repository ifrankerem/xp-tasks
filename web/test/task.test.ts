import { describe, expect, it } from 'vitest'
import {
  completionPatch,
  currentOccurrence,
  deletionPatch,
  fromRecord,
  isOccurrenceDone,
  nextAlarm,
  occursOnDay,
  restorePatch,
  toBody,
  type Task,
} from '../src/lib/task'

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min)

const task = (extra: Partial<Task> = {}): Task => ({
  id: 'task00000001',
  title: 'Süt al',
  note: '',
  photo: null,
  date: null,
  alarm: null,
  repeat: null,
  position: 0,
  status: 'open',
  archivedAs: null,
  archivedAt: null,
  doneOn: null,
  createdAt: at(2026, 11, 2, 9).getTime(),
  updated: '',
  ...extra,
})

const saturdays = { kind: 'weekly', days: [6], interval: 1 } as const

describe('occurrences per day', () => {
  it('a one-off task occurs only on its date', () => {
    const t = task({ date: '2026-11-14' })
    expect(occursOnDay(t, '2026-11-14')).toBe(true)
    expect(occursOnDay(t, '2026-11-15')).toBe(false)
    expect(occursOnDay(task(), '2026-11-02')).toBe(false) // no date: on no day
  })

  it('a repeating task without a date counts from the day it was created', () => {
    const t = task({ repeat: { kind: 'daily', interval: 2 } }) // created Mon 2026-11-02
    expect(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map((d) => occursOnDay(t, d))).toEqual([false, true, false, true])
  })

  it('archived tasks occur on no day', () => {
    expect(occursOnDay(task({ date: '2026-11-14', status: 'archived', archivedAs: 'done' }), '2026-11-14')).toBe(false)
  })
})

describe('archive rules', () => {
  const now = at(2026, 11, 5, 12) // Thursday

  it('Tamamlandı archives a one-off task as done', () => {
    expect(completionPatch(task({ date: '2026-11-05' }), now)).toEqual({ status: 'archived', archivedAs: 'done', archivedAt: now.getTime() })
  })

  it('Tamamlandı on a repeating task marks only the current occurrence', () => {
    const t = task({ repeat: saturdays })
    const patch = completionPatch(t, now)
    expect(patch).toEqual({ doneOn: '2026-11-07' }) // the coming Saturday; the task stays open
    expect(isOccurrenceDone({ ...t, ...patch }, '2026-11-05')).toBe(true)
    expect(isOccurrenceDone({ ...t, ...patch }, '2026-11-08')).toBe(false) // next occurrence is open again
  })

  it('the alarm screen can complete the occurrence that is ringing', () => {
    expect(completionPatch(task({ repeat: saturdays }), now, '2026-11-14')).toEqual({ doneOn: '2026-11-14' })
  })

  it('Sil archives any task, repeating or not', () => {
    expect(deletionPatch(now)).toEqual({ status: 'archived', archivedAs: 'deleted', archivedAt: now.getTime() })
  })

  it('patches are absolute, so applying one twice changes nothing', () => {
    const t = task({ date: '2026-11-05' })
    const once = { ...t, ...completionPatch(t, now) }
    expect({ ...once, ...completionPatch(once, now) }).toEqual(once)
    const restored = { ...once, ...restorePatch() }
    expect({ ...restored, ...restorePatch() }).toEqual(restored)
    expect(restored.status).toBe('open')
  })

  it('current occurrence is today when it occurs today, otherwise the next one', () => {
    expect(currentOccurrence(task({ repeat: saturdays }), '2026-11-07')).toBe('2026-11-07')
    expect(currentOccurrence(task({ repeat: saturdays }), '2026-11-08')).toBe('2026-11-14')
    expect(currentOccurrence(task({ date: '2026-11-20' }), '2026-11-08')).toBe('2026-11-20')
  })
})

describe('nextAlarm', () => {
  it('a one-off alarm rings once on its date', () => {
    const t = task({ date: '2026-11-14', alarm: '18:30' })
    expect(nextAlarm(t, at(2026, 11, 14, 18, 29))).toBe(at(2026, 11, 14, 18, 30).getTime())
    expect(nextAlarm(t, at(2026, 11, 14, 18, 30))).toBeNull()
  })

  it('a one-off alarm without a date rings on the day it was created', () => {
    expect(nextAlarm(task({ alarm: '18:30' }), at(2026, 11, 2, 10))).toBe(at(2026, 11, 2, 18, 30).getTime())
    expect(nextAlarm(task({ alarm: '08:00' }), at(2026, 11, 2, 10))).toBeNull()
  })

  it('a repeating alarm moves to the next occurrence once today has rung', () => {
    const t = task({ repeat: saturdays, alarm: '10:00' })
    expect(nextAlarm(t, at(2026, 11, 7, 9))).toBe(at(2026, 11, 7, 10).getTime())
    expect(nextAlarm(t, at(2026, 11, 7, 10))).toBe(at(2026, 11, 14, 10).getTime())
  })

  it('a completed occurrence does not ring; the next one does', () => {
    const t = task({ repeat: saturdays, alarm: '10:00', doneOn: '2026-11-07' })
    expect(nextAlarm(t, at(2026, 11, 7, 9))).toBe(at(2026, 11, 14, 10).getTime())
  })

  it('archived tasks and tasks without an alarm never ring', () => {
    expect(nextAlarm(task({ repeat: saturdays }), at(2026, 11, 7, 9))).toBeNull()
    expect(nextAlarm(task({ repeat: saturdays, alarm: '10:00', status: 'archived', archivedAs: 'deleted' }), at(2026, 11, 7, 9))).toBeNull()
  })
})

describe('server mapping', () => {
  it('reads PocketBase empty values as null and cleans the rule', () => {
    const t = fromRecord({
      id: 'abcdefgh12', title: 'x', note: '', photo: '', date: '', alarm: '', repeat: { kind: 'weekly', days: [6, 6] },
      position: -1.5, status: 'open', archivedAs: '', archivedAt: 0, doneOn: '', createdAt: 5, updated: '2026-11-02 00:35:13.454Z',
    })
    expect(t).toEqual(task({
      id: 'abcdefgh12', title: 'x', position: -1.5, createdAt: 5, updated: '2026-11-02 00:35:13.454Z',
      repeat: { kind: 'weekly', days: [6], interval: 1 },
    }))
  })

  it('writes only the fields given, never id, photo or updated', () => {
    expect(toBody({ title: 'y', date: null, repeat: null, archivedAt: null })).toEqual({ title: 'y', date: null, repeat: null, archivedAt: null })
    expect(toBody({ id: 'x', photo: 'p.jpg', updated: 'u', note: 'n' } as Partial<Task>)).toEqual({ note: 'n' })
  })
})
