// node --test deploy/migrate/map.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapBackup, normalizeRule } from './map.mjs'

const v1 = (extra = {}) => ({
  id: 'mhf2k3l9x0abcdefgh',
  title: 'Süt al',
  type: 'text',
  createdDate: '2026-11-01T22:03:12.605Z',
  lastEditedDate: '2026-11-02T08:00:00.000Z',
  completed: false,
  ...extra,
})

test('keeps the id, the manual order and the creation time', () => {
  const { tasks } = mapBackup([v1({ id: 'aaaaaaaa1' }), v1({ id: 'bbbbbbbb2' })])
  assert.deepEqual(tasks.map((t) => [t.id, t.fields.position]), [['aaaaaaaa1', 0], ['bbbbbbbb2', 1]])
  assert.equal(tasks[0].fields.createdAt, Date.parse('2026-11-01T22:03:12.605Z'))
})

test('maps fields to the v2 schema', () => {
  const { tasks } = mapBackup([v1({ detail: 'iki litre', dueDate: '2026-11-14', alarm: '9:05' })])
  assert.deepEqual(tasks[0].fields, {
    title: 'Süt al', note: 'iki litre', date: '2026-11-14', alarm: '09:05', repeat: null, position: 0,
    status: 'open', archivedAs: null, archivedAt: null, doneOn: null, createdAt: Date.parse('2026-11-01T22:03:12.605Z'),
  })
})

test('completed tasks go to Arşiv as done, dated by their last edit', () => {
  const { tasks } = mapBackup([v1({ completed: true })])
  assert.deepEqual(
    [tasks[0].fields.status, tasks[0].fields.archivedAs, tasks[0].fields.archivedAt],
    ['archived', 'done', Date.parse('2026-11-02T08:00:00.000Z')],
  )
})

test('converts repeats: structured rules, legacy weekday strings, and none', () => {
  assert.deepEqual(normalizeRule({ kind: 'none' }), null)
  assert.deepEqual(normalizeRule(undefined, 'Mon, Wed, Fri'), { kind: 'weekly', days: [1, 3, 5], interval: 1 })
  assert.deepEqual(normalizeRule({ kind: 'weekly', days: [5, 1, 1], interval: 2 }), { kind: 'weekly', days: [1, 5], interval: 2 })
  assert.deepEqual(normalizeRule({ kind: 'daily', interval: 0 }), { kind: 'daily', interval: 1 })
  assert.deepEqual(normalizeRule({ kind: 'monthly', dayOfMonth: 31 }), { kind: 'monthly', dayOfMonth: 31 })
  assert.deepEqual(mapBackup([v1({ repeats: 'Sat' })]).tasks[0].fields.repeat, { kind: 'weekly', days: [6], interval: 1 })
})

test('decodes data-URL photos and refuses types the server will not take', () => {
  const png = 'data:image/png;base64,' + Buffer.from('png bytes').toString('base64')
  const { tasks, warnings } = mapBackup([v1({ id: 'withphoto1', photo: png }), v1({ id: 'badphoto01', photo: 'data:image/gif;base64,R0lG' })])
  assert.equal(tasks[0].photo.type, 'image/png')
  assert.equal(tasks[0].photo.bytes.toString(), 'png bytes')
  assert.equal(tasks[1].photo, null)
  assert.match(warnings.join('\n'), /badphoto01.*image\/gif/)
})

test('skips rows that cannot be stored, and says why', () => {
  const { tasks, skipped } = mapBackup([v1({ id: 'BAD ID' }), v1({ id: 'emptytitle', title: '  ' }), v1({ id: 'dupe00001' }), v1({ id: 'dupe00001' })])
  assert.deepEqual(tasks.map((t) => t.id), ['dupe00001'])
  assert.deepEqual(skipped.map((s) => s.reason), ['invalid id', 'empty title', 'duplicate id'])
})

test('drops malformed dates and alarm times instead of failing the row', () => {
  const { tasks, warnings } = mapBackup([v1({ dueDate: '14.11.2026', alarm: '25:00' })])
  assert.equal(tasks[0].fields.date, null)
  assert.equal(tasks[0].fields.alarm, null)
  assert.equal(warnings.length, 2)
})

test('a title too long for v2 keeps its first line, and the whole text moves to the note', () => {
  const long = 'Alışveriş listesi\n' + 'x'.repeat(800)
  const { tasks, warnings } = mapBackup([v1({ title: long, detail: 'eski not' })])
  assert.equal(tasks[0].fields.title, 'Alışveriş listesi')
  assert.equal(tasks[0].fields.note, `${long}\n\neski not`)
  const oneLine = mapBackup([v1({ title: 'y'.repeat(600) })]).tasks[0].fields
  assert.equal(oneLine.title.length, 500)
  assert.equal(oneLine.note, 'y'.repeat(600))
  assert.match(warnings[0], /moved into the note/)
})
