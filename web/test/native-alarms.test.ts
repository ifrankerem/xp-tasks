// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { Store } from '../src/lib/store'
import { startNativeAlarms, type NativeAlarms } from '../src/lib/native-alarms'
let store: Store
let stop: (() => void) | undefined
beforeEach(() => { store = new Store(`native-${crypto.randomUUID()}`) })
afterEach(async () => { stop?.(); stop = undefined; await store.db.delete() })
function bridge(actions: { id: string; taskId: string; occurrence: string; at: number }[] = []) {
  let changed = () => {}
  const native = {
    getActions: vi.fn(async () => ({ actions: [...actions] })),
    acknowledge: vi.fn(async ({ ids }: { ids: string[] }) => { actions = actions.filter(action => !ids.includes(action.id)) }),
    replaceTasks: vi.fn(async () => {}),
    addListener: vi.fn(async (_event: string, callback: () => void) => { changed = callback; return { remove: vi.fn(async () => {}) } }),
  }
  return { native: native as unknown as NativeAlarms, mocks: native, changed: () => changed() }
}
const at = new Date(2026, 10, 3, 12).getTime()
it('persists native completion before acknowledging and sends the resulting local schedule', async () => {
  const task = await store.create({ title: 'Kapalıyken tamamlandı', date: '2026-11-03', alarm: '12:00' })
  const { native, mocks } = bridge([{ id: 'action1', taskId: task.id, occurrence: '2026-11-03', at }])
  mocks.acknowledge.mockImplementation(async () => {
    expect(await store.db.tasks.get(task.id)).toMatchObject({ status: 'archived', archivedAs: 'done', archivedAt: at })
  })
  stop = startNativeAlarms(store, native, vi.fn())
  await waitFor(() => expect(mocks.acknowledge).toHaveBeenCalledWith({ ids: ['action1'] }))
  await waitFor(() => expect(mocks.replaceTasks).toHaveBeenCalledWith({ tasks: [expect.objectContaining({ id: task.id, status: 'archived' })] }))
})
it('does not acknowledge a failed local write and retries on resume', async () => {
  const task = await store.create({ title: 'Tekrar dene', date: '2026-11-03' })
  vi.spyOn(store, 'completeFromAlarm').mockRejectedValueOnce(new Error('disk full'))
  const { native, mocks } = bridge([{ id: 'action2', taskId: task.id, occurrence: '2026-11-03', at }])
  const error = vi.fn()
  stop = startNativeAlarms(store, native, error)
  await waitFor(() => expect(error).toHaveBeenCalledWith(expect.any(String)))
  expect(mocks.acknowledge).not.toHaveBeenCalled()
  document.dispatchEvent(new Event('visibilitychange'))
  await waitFor(() => expect(mocks.acknowledge).toHaveBeenCalled())
})
it('reconciles local and remote task changes and stops observing after cleanup', async () => {
  const { native, mocks } = bridge()
  stop = startNativeAlarms(store, native, vi.fn())
  await waitFor(() => expect(mocks.replaceTasks).toHaveBeenCalled())
  const task = await store.create({ title: 'Yerel', alarm: '10:00', date: '2026-12-01' })
  await waitFor(() => expect(mocks.replaceTasks).toHaveBeenLastCalledWith({ tasks: [expect.objectContaining({ alarm: '10:00' })] }))
  await store.db.tasks.update(task.id, { alarm: '11:00' })
  await waitFor(() => expect(mocks.replaceTasks).toHaveBeenLastCalledWith({ tasks: [expect.objectContaining({ alarm: '11:00' })] }))
  stop(); stop = undefined
  const calls = mocks.replaceTasks.mock.calls.length
  await store.remove(task.id)
  await new Promise(resolve => setTimeout(resolve, 50))
  expect(mocks.replaceTasks).toHaveBeenCalledTimes(calls)
})
it('stale and repeated native actions cannot resurrect tasks or regress repeat completion', async () => {
  const deleted = await store.create({ title: 'Silinmiş', date: '2026-11-03' })
  await store.remove(deleted.id)
  await store.completeFromAlarm(deleted.id, new Date(at), '2026-11-03')
  expect(await store.db.tasks.get(deleted.id)).toMatchObject({ status: 'archived', archivedAs: 'deleted' })
  const repeat = await store.create({ title: 'Tekrar', date: '2026-11-02', repeat: { kind: 'daily', interval: 2 } })
  await store.complete(repeat.id, new Date(at), '2026-11-14')
  await store.completeFromAlarm(repeat.id, new Date(at), '2026-11-04')
  await store.completeFromAlarm(repeat.id, new Date(at), '2026-11-15')
  expect((await store.db.tasks.get(repeat.id))?.doneOn).toBe('2026-11-14')
  await store.completeFromAlarm(repeat.id, new Date(at), '2026-11-16')
  await store.completeFromAlarm(repeat.id, new Date(at), '2026-11-16')
  expect((await store.db.tasks.get(repeat.id))?.doneOn).toBe('2026-11-16')
})
