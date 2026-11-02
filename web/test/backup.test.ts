import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store } from '../src/lib/store'
import { exportBackup, importBackup } from '../src/lib/backup'
import { Sync } from '../src/lib/sync'
import { FakeApi } from './fake-api'

let source: Store, target: Store
const now = new Date(2026, 10, 3, 12)
beforeEach(() => {
  source = new Store(`backup-source-${crypto.randomUUID()}`)
  target = new Store(`backup-target-${crypto.randomUUID()}`)
})
afterEach(async () => {
  await source.db.delete()
  await target.db.delete()
})
const noPhoto = vi.fn(async () => {
  throw new Error('unexpected photo request')
})

describe('portable backups', () => {
  it('round trips IDs, order, archives, repeat completion and pending photos without duplicates', async () => {
    const first = await source.create(
      {
        title: 'Tekrar',
        date: '2026-11-02',
        repeat: { kind: 'daily', interval: 2 },
        photo: new Blob(['photo'], { type: 'image/jpeg' }),
      },
      now,
    )
    const second = await source.create({ title: 'Arşiv', note: 'Not' }, now)
    await source.complete(first.id, now, '2026-11-04')
    await source.remove(second.id, now)
    const text = await exportBackup(source, noPhoto)
    expect(JSON.parse(text).tasks[1].photo).toBe('data:image/jpeg;base64,cGhvdG8=')
    expect(await importBackup(target, text)).toEqual({ imported: 2, skipped: 0 })
    await importBackup(target, text)
    const tasks = await target.db.tasks.orderBy('position').toArray()
    expect(tasks.map((t) => t.id)).toEqual([second.id, first.id])
    expect(tasks[0]).toMatchObject({
      status: 'archived',
      archivedAs: 'deleted',
      archivedAt: now.getTime(),
      note: 'Not',
    })
    expect(tasks[1]).toMatchObject({
      repeat: first.repeat,
      date: first.date,
      doneOn: '2026-11-04',
      position: first.position,
      createdAt: first.createdAt,
    })
    expect(await (await target.db.photos.get(first.id))!.blob.text()).toBe('photo')
    const api = new FakeApi()
    expect(await new Sync(target, api).run()).toBe('ok')
    expect(api.records.size).toBe(2)
    expect(await api.photos.get(first.id)?.text()).toBe('photo')
  })
  it('embeds remote photos and fails instead of exporting an incomplete backup', async () => {
    const task = await source.create({ title: 'Sunucu fotoğrafı' }, now)
    await source.db.tasks.update(task.id, { photo: 'remote.jpg' })
    const load = vi.fn(async () => new Blob(['remote'], { type: 'image/png' }))
    const json = JSON.parse(await exportBackup(source, load))
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ id: task.id }))
    expect(json.tasks[0].photo).toBe('data:image/png;base64,cmVtb3Rl')
    await expect(
      exportBackup(source, async () => {
        throw new Error('offline')
      }),
    ).rejects.toThrow('offline')
  })
  it('pending photos take priority over the old server file', async () => {
    const task = await source.create(
      { title: 'Fotoğraf', photo: new Blob(['new'], { type: 'image/webp' }) },
      now,
    )
    await source.db.tasks.update(task.id, { photo: 'old.jpg' })
    const json = JSON.parse(await exportBackup(source, noPhoto))
    expect(json.tasks[0].photo).toBe('data:image/webp;base64,bmV3')
  })
  it('upserts existing tasks, removes a replaced photo and leaves unrelated tasks alone', async () => {
    const task = await source.create({ title: 'Yedek adı' }, now)
    await target.create(
      { title: 'Mevcut', photo: new Blob(['old'], { type: 'image/jpeg' }) },
      now,
      task.id,
    )
    const unrelated = await target.create({ title: 'Başka görev' }, now)
    await importBackup(target, await exportBackup(source, noPhoto))
    expect(await target.db.tasks.get(task.id)).toMatchObject({
      title: 'Yedek adı',
      photo: null,
      position: task.position,
    })
    expect(await target.db.photos.get(task.id)).toBeUndefined()
    expect(await target.db.tasks.get(unrelated.id)).toBeDefined()
  })
  it('skips permanently deleted IDs instead of resurrecting them', async () => {
    const task = await source.create({ title: 'Kalıcı silindi' }, now)
    await target.purge(task.id)
    expect(await importBackup(target, await exportBackup(source, noPhoto))).toEqual({
      imported: 0,
      skipped: 1,
    })
    expect(await target.db.tasks.get(task.id)).toBeUndefined()
    expect(await target.db.outbox.toArray()).toEqual([
      expect.objectContaining({ kind: 'delete', taskId: task.id }),
    ])
  })
  it('applies imported fields when a missing local ID already exists on the server', async () => {
    const task = await source.create({ title: 'Yedek', note: 'geri yüklenen' }, now)
    const api = new FakeApi()
    api.remoteWrite({ ...task, title: 'Sunucudaki eski ad' })
    await importBackup(target, await exportBackup(source, noPhoto))
    expect(await new Sync(target, api).run()).toBe('ok')
    expect(api.records.get(task.id)).toMatchObject({ title: 'Yedek', note: 'geri yüklenen' })
  })
  it.each([
    ['version', { version: 99 }],
    ['duplicate id', {}],
    ['bad id', { id: '../bad' }],
    ['title', { title: ' ' }],
    ['date', { date: '2026-02-30' }],
    ['position', { position: 'first' }],
    ['repeat', { repeat: { kind: 'daily', interval: 0 } }],
    ['archive', { status: 'archived' }],
    ['archive reason', { status: 'archived', archivedAs: ['done'], archivedAt: now.getTime() }],
    ['photo', { photo: 'data:image/svg+xml;base64,PHN2Zy8+' }],
  ])('rejects invalid %s before writing any task or outbox entry', async (kind, patch) => {
    await source.create({ title: 'Valid' }, now)
    await source.create({ title: 'Another valid task' }, now)
    const backup = JSON.parse(await exportBackup(source, noPhoto))
    if (kind === 'version') Object.assign(backup, patch)
    else if (kind === 'duplicate id') backup.tasks.push(backup.tasks[0])
    else Object.assign(backup.tasks[1], patch)
    await expect(importBackup(target, JSON.stringify(backup))).rejects.toThrow()
    expect(await target.db.tasks.count()).toBe(0)
    expect(await target.db.outbox.count()).toBe(0)
  })
  it('rolls back every task and photo if the local transaction fails', async () => {
    await source.create({ title: 'Bir' }, now)
    await source.create({ title: 'İki' }, now)
    vi.spyOn(target.db.outbox, 'add').mockRejectedValueOnce(new Error('disk full'))
    await expect(importBackup(target, await exportBackup(source, noPhoto))).rejects.toThrow(
      'disk full',
    )
    expect(await target.db.tasks.count()).toBe(0)
    expect(await target.db.photos.count()).toBe(0)
  })
})
