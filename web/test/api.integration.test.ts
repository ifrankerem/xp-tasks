// The PocketBase adapter against a real, throwaway PocketBase with our schema.
// Runs only when PB_BIN points at a pocketbase binary (same version as the
// Dockerfile), e.g.  PB_BIN=/path/to/pocketbase npm test

import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import PocketBase from 'pocketbase'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ApiError, pocketbaseApi, type TaskApi } from '../src/lib/api'
import { toBody } from '../src/lib/task'

const bin = process.env.PB_BIN
const base = 'http://127.0.0.1:18097'

describe.skipIf(!bin)('pocketbaseApi', () => {
  let server: ChildProcess
  let dir: string
  let api: TaskApi
  let pb: PocketBase

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pb-api-'))
    const args = ['--dir', dir, '--migrationsDir', join(__dirname, '../../deploy/pocketbase/pb_migrations'), '--automigrate=false', '--dev=false']
    execFileSync(bin!, ['migrate', 'up', ...args], { stdio: 'ignore' })
    execFileSync(bin!, ['superuser', 'upsert', 'root@test.local', 'root-password-1', ...args], { stdio: 'ignore' })
    server = spawn(bin!, ['serve', '--http', '127.0.0.1:18097', ...args], { stdio: 'ignore' })
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) break
      } catch {}
      await new Promise((r) => setTimeout(r, 100))
    }
    const root = new PocketBase(base)
    await root.collection('_superusers').authWithPassword('root@test.local', 'root-password-1')
    await root.collection('users').create({ email: 'me@test.local', password: 'user-password-1', passwordConfirm: 'user-password-1' })
    pb = new PocketBase(base)
    await pb.collection('users').authWithPassword('me@test.local', 'user-password-1')
    api = pocketbaseApi(pb)
  })

  afterAll(() => {
    server?.kill()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  const fields = {
    title: 'Süt al', note: '', date: '2026-11-14', alarm: '18:30', repeat: { kind: 'weekly', days: [6], interval: 1 } as const,
    position: -1, status: 'open' as const, archivedAs: null, archivedAt: null, doneOn: null, createdAt: 1793577600000,
  }
  const kind = (p: Promise<unknown>) => p.then(() => 'ok', (e: ApiError) => e.kind)

  it('creates with the client id and reports a second create as duplicate', async () => {
    const t = await api.create('task0000000001', toBody(fields))
    expect(t).toMatchObject({ id: 'task0000000001', date: '2026-11-14', repeat: fields.repeat, archivedAt: null })
    expect(t.updated).not.toBe('')
    expect(await kind(api.create('task0000000001', toBody(fields)))).toBe('duplicate')
  })

  it('patches only the given fields and clears with null', async () => {
    const t = await api.update('task0000000001', { note: 'not', date: null, repeat: null })
    expect(t).toMatchObject({ title: 'Süt al', note: 'not', date: null, repeat: null, alarm: '18:30' })
  })

  it('reports invalid values as invalid', async () => {
    expect(await kind(api.update('task0000000001', { alarm: '25:00' }))).toBe('invalid')
  })

  it('uploads and removes a photo in the same call as other fields', async () => {
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64')
    const withPhoto = await api.create('task0000000002', toBody({ ...fields, repeat: null }), new Blob([jpeg], { type: 'image/jpeg' }))
    expect(withPhoto.photo).toMatch(/\.jpg$/)
    expect(withPhoto.repeat).toBeNull() // null survives the multipart body
    const changed = await api.update('task0000000002', { title: 'yeni', doneOn: null }, null)
    expect(changed).toMatchObject({ title: 'yeni', photo: null })
  })

  it('lists, deletes, and reports a second delete as not found', async () => {
    expect((await api.list()).map((t) => t.id).sort()).toEqual(['task0000000001', 'task0000000002'])
    await api.remove('task0000000002')
    expect(await kind(api.remove('task0000000002'))).toBe('notFound')
    expect(await kind(api.update('task0000000002', { title: 'x' }))).toBe('notFound')
  })

  it('a list with a bad token fails as auth instead of returning no tasks', async () => {
    const good = pb.authStore.token
    pb.authStore.save('not-a-token', pb.authStore.record)
    expect(await kind(api.list())).toBe('auth')
    pb.authStore.save(good, pb.authStore.record)
    expect((await api.list()).length).toBe(1)
  })

  it('reports a signed-out client as auth, and a dead server as network', async () => {
    pb.authStore.clear()
    expect(await kind(api.create('task0000000003', toBody(fields)))).toBe('auth')
    expect(await kind(pocketbaseApi(new PocketBase('http://127.0.0.1:1')).list())).toBe('network')
  })
})
