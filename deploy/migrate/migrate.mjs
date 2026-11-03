#!/usr/bin/env node
// One-off move of v1 tasks into v2 PocketBase. See deploy/README.md "Migration".
//
//   node deploy/migrate/migrate.mjs BACKUP.json            # dry run (default)
//   node deploy/migrate/migrate.mjs BACKUP.json --apply    # write
//
// Credentials come from PB_EMAIL and PB_PASSWORD (the app account, not the
// superuser). Without them it only checks the file. Re-running never
// duplicates: tasks keep their v1 ids and ids already on the server are skipped.

import { readFileSync } from 'node:fs'
import { mapBackup } from './map.mjs'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
const apply = args.includes('--apply')
const server = (args.find((a) => a.startsWith('--server='))?.slice(9) ?? 'https://xp.irfankerem.com').replace(/\/$/, '')
if (!file) {
  console.error('usage: node deploy/migrate/migrate.mjs BACKUP.json [--apply] [--server=URL]')
  process.exit(2)
}

const { tasks, skipped, warnings } = mapBackup(JSON.parse(readFileSync(file, 'utf8')))
const count = (pred) => tasks.filter(pred).length
console.log(`backup: ${tasks.length + skipped.length} rows -> ${tasks.length} tasks, ${skipped.length} skipped`)
console.log(`  open ${count((t) => t.fields.status === 'open')}, archived as done ${count((t) => t.fields.status === 'archived')}`)
console.log(`  with date ${count((t) => t.fields.date)}, alarm ${count((t) => t.fields.alarm)}, repeat ${count((t) => t.fields.repeat)}, photo ${count((t) => t.photo)}`)
for (const s of skipped) console.log(`  skipped row ${s.index} (${s.id}): ${s.reason}`)
for (const w of warnings) console.log(`  warning: ${w}`)

const { PB_EMAIL: email, PB_PASSWORD: password } = process.env
if (!email || !password) {
  console.log('\nPB_EMAIL / PB_PASSWORD not set: checked the file only, nothing sent.')
  process.exit(0)
}

async function api(path, init = {}) {
  const res = await fetch(server + path, init)
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

const login = await api('/api/collections/users/auth-with-password', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: email, password }),
})
if (login.status !== 200) {
  console.error(`login failed (${login.status}): ${login.body.message ?? ''}`)
  process.exit(1)
}
const auth = { Authorization: login.body.token }
const owner = login.body.record.id

async function serverIds() {
  const ids = new Set()
  for (let page = 1; ; page++) {
    const res = await api(`/api/collections/tasks/records?page=${page}&perPage=500&fields=id&skipTotal=1`, { headers: auth })
    if (res.status !== 200) throw new Error(`listing tasks failed (${res.status})`)
    for (const r of res.body.items) ids.add(r.id)
    if (res.body.items.length < 500) return ids
  }
}

const before = await serverIds()
const missing = tasks.filter((t) => !before.has(t.id))
console.log(`\nserver ${server}: ${before.size} tasks now; ${tasks.length - missing.length} of the backup already there, ${missing.length} to create`)
if (!apply) {
  console.log('dry run: nothing written. Add --apply to create them.')
  process.exit(0)
}

let created = 0
const failed = []
for (const t of missing) {
  const fields = { ...t.fields, id: t.id, owner }
  let init
  if (t.photo) {
    const form = new FormData()
    for (const [k, v] of Object.entries(fields)) form.append(k, v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
    form.append('photo', new Blob([t.photo.bytes], { type: t.photo.type }), `photo.${t.photo.type.split('/')[1]}`)
    init = { method: 'POST', headers: auth, body: form }
  } else {
    init = { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(fields) }
  }
  const res = await api('/api/collections/tasks/records', init)
  if (res.status === 200) created++
  else if (res.status === 400 && res.body.data?.id?.code === 'validation_not_unique') continue // made by a parallel run
  else failed.push(`${t.id}: ${res.status} ${JSON.stringify(res.body.data ?? res.body.message)}`)
}

const after = await serverIds()
const absent = tasks.filter((t) => !after.has(t.id)).map((t) => t.id)
console.log(`created ${created}, failed ${failed.length}`)
for (const f of failed) console.log(`  failed ${f}`)
console.log(`check: backup ${tasks.length} tasks, on server ${tasks.length - absent.length}; server total ${before.size} -> ${after.size}`)
if (absent.length) {
  console.log(`  missing on server: ${absent.join(', ')}`)
  process.exit(1)
}
console.log('all backup tasks are on the server.')
