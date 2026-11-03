import { expect, it } from 'vitest'
import vectors from '../../test-vectors/alarms.json'
import { fromRecord, nextAlarm } from '../src/lib/task'

it.each(vectors.alarms)('shared Android alarm vector: $name', ({ task, now, next }) => {
  expect(nextAlarm(fromRecord(task), new Date(now))).toBe(next ? new Date(next).getTime() : null)
})
