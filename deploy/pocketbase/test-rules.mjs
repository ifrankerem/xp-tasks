// Checks the schema and API rules in pb_migrations against a throwaway PocketBase.
//
//   node deploy/pocketbase/test-rules.mjs /path/to/pocketbase
//
// Starts the given binary on 127.0.0.1:18090 with a temp data dir, so it never
// touches real data. Exits non-zero on the first failed check.

import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const bin = process.argv[2]
if (!bin) {
  console.error('usage: node deploy/pocketbase/test-rules.mjs /path/to/pocketbase')
  process.exit(2)
}

const migrations = join(dirname(fileURLToPath(import.meta.url)), 'pb_migrations')
const dir = mkdtempSync(join(tmpdir(), 'pb-rules-'))
const base = 'http://127.0.0.1:18090'
const args = ['--dir', dir, '--migrationsDir', migrations, '--automigrate=false']

execFileSync(bin, ['migrate', 'up', ...args], { stdio: 'ignore' })
execFileSync(bin, ['superuser', 'upsert', 'root@test.local', 'root-password-1', ...args], { stdio: 'ignore' })
const server = spawn(bin, ['serve', '--http', '127.0.0.1:18090', ...args], { stdio: 'ignore' })

async function api(method, path, { token, body, form } = {}) {
  const headers = {}
  if (token) headers.Authorization = token
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(base + path, { method, headers, body: form ?? (body && JSON.stringify(body)) })
  const text = await res.text()
  return { status: res.status, data: text ? JSON.parse(text) : null }
}

async function login(collection, identity, password) {
  const res = await api('POST', `/api/collections/${collection}/auth-with-password`, { body: { identity, password } })
  assert.equal(res.status, 200, `login ${identity}`)
  return res.data
}

const task = (owner, extra = {}) => ({ owner, title: 'Süt al', status: 'open', createdAt: 1730000000000, ...extra })

try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(base + '/api/health')).ok) break } catch {}
    if (i > 50) throw new Error('PocketBase did not start')
    await new Promise((r) => setTimeout(r, 100))
  }

  const root = (await login('_superusers', 'root@test.local', 'root-password-1')).token
  for (const email of ['me@test.local', 'other@test.local']) {
    const res = await api('POST', '/api/collections/users/records', {
      token: root,
      body: { email, password: 'user-password-1', passwordConfirm: 'user-password-1' },
    })
    assert.equal(res.status, 200, `create ${email}`)
  }

  const signup = await api('POST', '/api/collections/users/records', {
    body: { email: 'x@test.local', password: 'user-password-1', passwordConfirm: 'user-password-1' },
  })
  assert.equal(signup.status, 403, 'public sign-up is closed')

  const me = await login('users', 'me@test.local', 'user-password-1')
  const other = await login('users', 'other@test.local', 'user-password-1')
  const meId = me.record.id

  const users = await api('GET', '/api/collections/users/records', { token: me.token })
  assert.deepEqual(users.data.items.map((u) => u.id), [meId], 'users see only themselves')

  const id = 'k3v9x0aa1b2c3d4e5' // 17 chars, like a v1 id
  const created = await api('POST', '/api/collections/tasks/records', { token: me.token, body: { id, ...task(meId) } })
  assert.equal(created.status, 200, 'owner creates a task with a client id')
  assert.ok(created.data.updated, 'updated autodate is set')

  const retry = await api('POST', '/api/collections/tasks/records', { token: me.token, body: { id, ...task(meId) } })
  assert.equal(retry.status, 400, 'a retried create does not duplicate')

  const forged = await api('POST', '/api/collections/tasks/records', { token: me.token, body: task(other.record.id) })
  assert.equal(forged.status, 400, 'cannot create a task for someone else')

  const anon = await api('GET', '/api/collections/tasks/records')
  assert.equal(anon.data.items.length, 0, 'guests see no tasks')

  const theirs = await api('GET', '/api/collections/tasks/records', { token: other.token })
  assert.equal(theirs.data.items.length, 0, 'other users see no tasks')
  for (const [method, body] of [['GET'], ['PATCH', { title: 'x' }], ['DELETE']]) {
    const res = await api(method, `/api/collections/tasks/records/${id}`, { token: other.token, body })
    assert.equal(res.status, 404, `other user ${method} is refused`)
  }

  const archived = await api('PATCH', `/api/collections/tasks/records/${id}`, {
    token: me.token,
    body: { status: 'archived', archivedAs: 'deleted', archivedAt: 1730000001000 },
  })
  assert.equal(archived.status, 200, 'owner archives')

  const steal = await api('PATCH', `/api/collections/tasks/records/${id}`, { token: me.token, body: { owner: other.record.id } })
  assert.equal(steal.status, 404, 'owner cannot be changed')

  for (const bad of [{ date: '2026-1-5' }, { alarm: '24:00' }, { status: 'gone' }]) {
    const res = await api('PATCH', `/api/collections/tasks/records/${id}`, { token: me.token, body: bad })
    assert.equal(res.status, 400, `rejects ${JSON.stringify(bad)}`)
  }

  const form = new FormData()
  form.append('photo', new Blob([Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64')], { type: 'image/jpeg' }), 'p.jpg')
  const withPhoto = await api('PATCH', `/api/collections/tasks/records/${id}`, { token: me.token, form })
  assert.equal(withPhoto.status, 200, 'photo upload')
  const fileUrl = `${base}/api/files/tasks/${id}/${withPhoto.data.photo}`
  assert.notEqual((await fetch(fileUrl)).status, 200, 'photo is not public')
  const fileToken = (await api('POST', '/api/files/token', { token: me.token })).data.token
  assert.equal((await fetch(`${fileUrl}?token=${fileToken}`)).status, 200, 'photo with file token')
  const otherFileToken = (await api('POST', '/api/files/token', { token: other.token })).data.token
  assert.notEqual((await fetch(`${fileUrl}?token=${otherFileToken}`)).status, 200, 'other user cannot read the photo')

  assert.equal((await api('DELETE', `/api/collections/tasks/records/${id}`, { token: me.token })).status, 204, 'owner deletes')
  assert.equal((await api('DELETE', `/api/collections/tasks/records/${id}`, { token: me.token })).status, 404, 'second delete is a 404')

  console.log('all rule checks passed')
} finally {
  server.kill()
  rmSync(dir, { recursive: true, force: true })
}
