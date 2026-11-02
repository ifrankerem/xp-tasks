import { beforeEach, describe, expect, it } from 'vitest'
import { Store } from '../src/lib/store'
import { Sync } from '../src/lib/sync'
import { FakeApi } from './fake-api'

let n = 0
const device = (api: FakeApi) => {
  const store = new Store(`test-${++n}`)
  return { store, sync: new Sync(store, api) }
}
const now = new Date(2026, 10, 5, 12) // Thu 2026-11-05 12:00
const open = async (store: Store) => (await store.db.tasks.orderBy('position').toArray()).filter((t) => t.status === 'open')

let api: FakeApi
beforeEach(() => {
  api = new FakeApi()
})

describe('local writes', () => {
  it('a write lands in the task table and the outbox together, before any network', async () => {
    const { store } = device(api)
    api.offline = true
    const t = await store.create({ title: 'Süt al' }, now)
    expect(await store.db.tasks.get(t.id)).toMatchObject({ title: 'Süt al', status: 'open', updated: '' })
    expect(await store.db.outbox.toArray()).toMatchObject([{ taskId: t.id, kind: 'create' }])
    expect(api.calls).toEqual([])
  })

  it('new tasks go on top; the app never reorders them by itself', async () => {
    const { store } = device(api)
    const a = await store.create({ title: 'a' }, now)
    const b = await store.create({ title: 'b' }, now)
    expect((await open(store)).map((t) => t.id)).toEqual([b.id, a.id])
  })

  it('a reorder writes only the moved task, and only its position', async () => {
    const { store, sync } = device(api)
    const c = await store.create({ title: 'c' }, now)
    const b = await store.create({ title: 'b' }, now)
    const a = await store.create({ title: 'a' }, now)
    await sync.run()
    api.calls = []
    await store.move(a.id, b.id, c.id) // a goes between b and c
    expect((await open(store)).map((t) => t.title)).toEqual(['b', 'a', 'c'])
    await sync.run()
    expect(api.calls).toEqual([`update ${a.id} position`, 'list'])
  })

  it('keeps the order when drags run out of room between two positions', async () => {
    const { store } = device(api)
    const bottom = await store.create({ title: 'bottom' }, now)
    const top = await store.create({ title: 'top' }, now)
    let below = bottom.id
    const moved: string[] = []
    for (let i = 0; i < 60; i++) {
      const t = await store.create({ title: `t${i}` }, now)
      await store.move(t.id, top.id, below) // always right under `top`
      below = t.id
      moved.unshift(t.id)
    }
    const list = await open(store)
    expect(list.map((t) => t.id)).toEqual([top.id, ...moved, bottom.id])
    expect(new Set(list.map((t) => t.position)).size).toBe(list.length)
  })
})

describe('sync', () => {
  it('pushes the outbox and takes the server copy back', async () => {
    const { store, sync } = device(api)
    const t = await store.create({ title: 'Süt al', date: '2026-11-14', alarm: '18:30' }, now)
    expect(await sync.run()).toBe('ok')
    expect(await store.db.outbox.count()).toBe(0)
    expect(api.records.get(t.id)).toMatchObject({ title: 'Süt al', date: '2026-11-14', alarm: '18:30' })
    expect((await store.db.tasks.get(t.id))!.updated).not.toBe('')
  })

  it('keeps every offline change and sends it when back online', async () => {
    const { store, sync } = device(api)
    api.offline = true
    const t = await store.create({ title: 'a' }, now)
    await store.update(t.id, { note: 'not' })
    await store.complete(t.id, now)
    expect(await sync.run()).toBe('offline')
    expect(await store.db.outbox.count()).toBe(3)
    api.offline = false
    expect(await sync.run()).toBe('ok')
    expect(api.records.get(t.id)).toMatchObject({ note: 'not', status: 'archived', archivedAs: 'done' })
  })

  it('a create whose response was lost is not duplicated on retry', async () => {
    const { store, sync } = device(api)
    await store.create({ title: 'a' }, now)
    api.loseNextResponse = true
    expect(await sync.run()).toBe('offline')
    expect(await sync.run()).toBe('ok')
    expect(api.records.size).toBe(1)
    expect(await store.db.outbox.count()).toBe(0)
    expect(sync.lastError).toBeNull() // a duplicate id means "already saved", not an error
  })

  it('a retried complete or delete lands on the same state', async () => {
    const { store, sync } = device(api)
    const t = await store.create({ title: 'a' }, now)
    await sync.run()
    await store.remove(t.id, now)
    api.loseNextResponse = true
    await sync.run() // server archived it, the phone did not hear back
    await sync.run() // sends the same patch again
    expect(api.records.get(t.id)).toMatchObject({ status: 'archived', archivedAs: 'deleted' })
    expect((await store.db.tasks.get(t.id))!.status).toBe('archived')
  })

  it('pulls changes from other devices: last write wins', async () => {
    const { store, sync } = device(api)
    const t = await store.create({ title: 'a' }, now)
    await sync.run()
    api.remoteWrite({ ...api.records.get(t.id)!, title: 'laptop' })
    await sync.run()
    expect((await store.db.tasks.get(t.id))!.title).toBe('laptop')
  })

  it('a change still in the outbox is not overwritten by a pull', async () => {
    const { store, sync } = device(api)
    const t = await store.create({ title: 'a' }, now)
    await sync.run()
    api.offline = true
    await store.update(t.id, { note: 'phone' })
    api.offline = false
    api.remoteWrite({ ...api.records.get(t.id)!, title: 'laptop' })
    await sync.pull()
    expect((await store.db.tasks.get(t.id))!.note).toBe('phone')
    await sync.run()
    // Only the changed field is sent, so both edits survive.
    expect(api.records.get(t.id)).toMatchObject({ title: 'laptop', note: 'phone' })
    expect(await store.db.tasks.get(t.id)).toMatchObject({ title: 'laptop', note: 'phone' })
  })

  it('applies realtime events, but not over pending local changes', async () => {
    const { store, sync } = device(api)
    const t = await store.create({ title: 'a' }, now)
    await sync.run()
    const stop = await sync.listen()
    api.remoteWrite({ ...api.records.get(t.id)!, title: 'laptop' })
    await sync.idle()
    expect((await store.db.tasks.get(t.id))!.title).toBe('laptop')
    api.offline = true
    await store.update(t.id, { title: 'phone' })
    api.remoteWrite({ ...api.records.get(t.id)!, title: 'laptop 2' })
    await sync.idle()
    expect((await store.db.tasks.get(t.id))!.title).toBe('phone')
    await stop()
  })
})

describe('deleted tasks never come back', () => {
  it('Sil stays archived even when a stale pull arrives before the push', async () => {
    const { store, sync } = device(api)
    const t = await store.create({ title: 'a' }, now)
    await sync.run()
    await store.remove(t.id, now)
    await sync.pull() // server still says open
    expect((await store.db.tasks.get(t.id))!.status).toBe('archived')
    await sync.run()
    expect(api.records.get(t.id)!.status).toBe('archived')
  })

  it("another device's offline edit does not reopen an archived task", async () => {
    const phone = device(api)
    const laptop = device(api)
    const t = await phone.store.create({ title: 'a' }, now)
    await phone.sync.run()
    await laptop.sync.run()
    api.offline = true
    await laptop.store.update(t.id, { title: 'laptop edit' })
    api.offline = false
    await phone.store.remove(t.id, now)
    await phone.sync.run()
    await laptop.sync.run()
    expect(api.records.get(t.id)).toMatchObject({ title: 'laptop edit', status: 'archived' })
    await phone.sync.run()
    expect((await phone.store.db.tasks.get(t.id))!.status).toBe('archived')
  })

  it('Kalıcı sil removes it everywhere and ignores late echoes of the record', async () => {
    const phone = device(api)
    const laptop = device(api)
    const t = await phone.store.create({ title: 'a' }, now)
    await phone.sync.run()
    await laptop.sync.run()
    const stale = api.records.get(t.id)!
    await phone.store.purge(t.id)
    expect(await phone.store.db.tasks.get(t.id)).toBeUndefined()
    await phone.sync.applyRemote(stale) // a realtime event that was in flight
    expect(await phone.store.db.tasks.get(t.id)).toBeUndefined()
    await phone.sync.run()
    expect(api.records.has(t.id)).toBe(false)
    await laptop.sync.run()
    expect(await laptop.store.db.tasks.get(t.id)).toBeUndefined()
    await laptop.sync.applyRemote(stale)
    expect(await laptop.store.db.tasks.get(t.id)).toBeUndefined()
  })

  it('a retried permanent delete is fine', async () => {
    const { store, sync } = device(api)
    const t = await store.create({ title: 'a' }, now)
    await sync.run()
    await store.purge(t.id)
    api.loseNextResponse = true
    expect(await sync.run()).toBe('offline')
    expect(await sync.run()).toBe('ok')
    expect(await store.db.outbox.count()).toBe(0)
  })

  it('purging a task the server never saw sends nothing that could recreate it', async () => {
    const { store, sync } = device(api)
    api.offline = true
    const t = await store.create({ title: 'a' }, now)
    await store.purge(t.id)
    api.offline = false
    await sync.run()
    expect(api.records.has(t.id)).toBe(false)
    expect(api.calls.some((c) => c.startsWith('create'))).toBe(false)
  })

  it('a record that outlived its purge on the server gets deleted', async () => {
    const { store, sync } = device(api)
    const t = await store.create({ title: 'a' }, now)
    await sync.run()
    await store.purge(t.id)
    await store.db.outbox.clear() // e.g. the delete was lost with an old install
    await sync.run()
    await sync.run()
    expect(api.records.has(t.id)).toBe(false)
  })

  it('an edit to a task purged elsewhere is dropped, not resurrected', async () => {
    const { store, sync } = device(api)
    const t = await store.create({ title: 'a' }, now)
    await sync.run()
    api.remoteDelete(t.id)
    await store.update(t.id, { title: 'too late' })
    expect(await sync.run()).toBe('ok')
    expect(api.records.has(t.id)).toBe(false)
    expect(await store.db.tasks.get(t.id)).toBeUndefined()
  })

  it('a pull removes synced tasks the server no longer has', async () => {
    const { store, sync } = device(api)
    const t = await store.create({ title: 'a' }, now)
    await sync.run()
    api.records.delete(t.id) // deleted while this device was away
    await sync.run()
    expect(await store.db.tasks.get(t.id)).toBeUndefined()
  })
})

describe('repeating tasks', () => {
  it('Tamamlandı keeps a repeating task open with only that occurrence done', async () => {
    const { store, sync } = device(api)
    const t = await store.create({ title: 'Çöp', repeat: { kind: 'weekly', days: [6], interval: 1 }, alarm: '10:00' }, now)
    await store.complete(t.id, now)
    await sync.run()
    expect(api.records.get(t.id)).toMatchObject({ status: 'open', doneOn: '2026-11-07' })
    await store.remove(t.id, now)
    await sync.run()
    expect(api.records.get(t.id)).toMatchObject({ status: 'archived', archivedAs: 'deleted' })
  })
})

describe('photos', () => {
  it('an offline photo waits locally, uploads with the task, then the local copy goes', async () => {
    const { store, sync } = device(api)
    api.offline = true
    const photo = new Blob(['jpeg bytes'], { type: 'image/jpeg' })
    const t = await store.create({ title: 'a', photo }, now)
    expect(await store.db.photos.get(t.id)).toBeDefined()
    api.offline = false
    await sync.run()
    expect(await api.photos.get(t.id)!.text()).toBe('jpeg bytes')
    expect((await store.db.tasks.get(t.id))!.photo).toBe(`${t.id}.jpg`)
    expect(await store.db.photos.get(t.id)).toBeUndefined()
  })

  it('removing a photo clears it on the server', async () => {
    const { store, sync } = device(api)
    const t = await store.create({ title: 'a', photo: new Blob(['x'], { type: 'image/jpeg' }) }, now)
    await sync.run()
    await store.update(t.id, {}, null)
    await sync.run()
    expect(api.records.get(t.id)!.photo).toBeNull()
    expect(api.photos.has(t.id)).toBe(false)
  })
})

describe('birthday task', () => {
  const title = 'İrfan Kerem Arslan DOGUM GÜNÜ'

  it('exists once for the coming 20 December, even when two devices make it at the same time', async () => {
    const phone = device(api)
    const laptop = device(api)
    await phone.store.ensureBirthday(now)
    await laptop.store.ensureBirthday(now)
    await phone.store.ensureBirthday(now)
    await phone.sync.run()
    await laptop.sync.run()
    await phone.sync.run()
    expect([...api.records.values()]).toMatchObject([{ id: 'birthday2026', title, date: '2026-12-20', status: 'open' }])
    expect(await laptop.store.db.tasks.count()).toBe(1)
  })

  it('after 20 December it is next year', async () => {
    const { store } = device(api)
    await store.ensureBirthday(new Date(2026, 11, 21))
    expect(await store.db.tasks.get('birthday2027')).toMatchObject({ date: '2027-12-20' })
  })

  it('a deleted birthday task is not made again', async () => {
    const { store, sync } = device(api)
    await store.ensureBirthday(now)
    await store.remove('birthday2026', now)
    await store.ensureBirthday(now)
    expect((await store.db.tasks.get('birthday2026'))!.status).toBe('archived')
    await sync.run()
    await store.purge('birthday2026')
    await store.ensureBirthday(now)
    expect(await store.db.tasks.get('birthday2026')).toBeUndefined()
  })
})
