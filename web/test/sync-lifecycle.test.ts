// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { Store } from '../src/lib/store'
import { Sync, startSync } from '../src/lib/sync'
import { FakeApi } from './fake-api'

afterEach(() => vi.useRealTimers())
it('stopping sync during an in-flight request prevents callbacks and retry timers', async () => {
  const store = new Store(`lifecycle-${crypto.randomUUID()}`)
  let resolve!: (result: 'offline') => void
  const sync = new Sync(store, new FakeApi()),
    result = vi.fn()
  vi.spyOn(sync, 'run').mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  const unsubscribe = vi.fn(async () => {})
  vi.spyOn(sync, 'listen').mockResolvedValue(unsubscribe)
  vi.useFakeTimers()
  const stop = startSync(sync, store, result)
  stop()
  resolve('offline')
  await Promise.resolve()
  await Promise.resolve()
  expect(result).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  expect(unsubscribe).toHaveBeenCalledOnce()
})
