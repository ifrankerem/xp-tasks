import { validDay } from './calendar'
import { normalizeRule } from './repeat'
import type { Store } from './store'
import { toBody, type Task, type TaskFields } from './task'

const invalid = () =>
  new Error('Geçerli bir xp-tasks v2 yedeği seçin. Hiçbir görev değiştirilmedi.')
const photoTypes = ['image/jpeg', 'image/png', 'image/webp']
const maxPhoto = 10 * 1024 * 1024
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const timestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 8.64e15

async function photoData(blob: Blob) {
  if (!photoTypes.includes(blob.type) || !blob.size || blob.size > maxPhoto)
    throw new Error('Yedek oluşturulamadı: fotoğraf biçimi veya boyutu desteklenmiyor.')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return `data:${blob.type};base64,${btoa(binary)}`
}

function photoBlob(value: unknown): Blob | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > Math.ceil(maxPhoto / 3) * 4 + 40) throw invalid()
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) throw invalid()
  let binary: string
  try {
    binary = atob(match[2]!)
  } catch {
    throw invalid()
  }
  if (btoa(binary) !== match[2] || !binary.length || binary.length > maxPhoto) throw invalid()
  return new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], { type: match[1] })
}

/** Snapshot local rows and pending photos together; download server photos outside the transaction. */
export async function exportBackup(
  store: Store,
  loadPhoto: (task: Task) => Promise<Blob>,
): Promise<string> {
  const { tasks, photos } = store.db
  const snapshot = await store.db.transaction('r', [tasks, photos], async () => ({
    tasks: await tasks.orderBy('position').toArray(),
    photos: new Map((await photos.toArray()).map((photo) => [photo.taskId, photo.blob])),
  }))
  const rows = []
  for (const task of snapshot.tasks) {
    const photo = snapshot.photos.get(task.id) ?? (task.photo ? await loadPhoto(task) : null)
    rows.push({ id: task.id, ...toBody(task), photo: photo ? await photoData(photo) : null })
  }
  return JSON.stringify({ format: 'xp-tasks', version: 1, tasks: rows }, null, 2)
}

/** Validate everything before the single local transaction; never accept server filenames as photos. */
export async function importBackup(store: Store, text: string) {
  let backup: unknown
  try {
    backup = JSON.parse(text)
  } catch {
    throw invalid()
  }
  if (
    !record(backup) ||
    backup.format !== 'xp-tasks' ||
    backup.version !== 1 ||
    !Array.isArray(backup.tasks)
  )
    throw invalid()
  const ids = new Set<string>()
  const entries = backup.tasks.map((raw: unknown) => {
    if (
      !record(raw) ||
      typeof raw.id !== 'string' ||
      !/^[a-z0-9]{8,32}$/.test(raw.id) ||
      ids.has(raw.id)
    )
      throw invalid()
    ids.add(raw.id)
    if (
      typeof raw.title !== 'string' ||
      !raw.title.trim() ||
      raw.title.length > 500 ||
      typeof raw.note !== 'string' ||
      raw.note.length > 20000 ||
      !(raw.date === null || (typeof raw.date === 'string' && validDay(raw.date))) ||
      !(raw.doneOn === null || (typeof raw.doneOn === 'string' && validDay(raw.doneOn))) ||
      !(
        raw.alarm === null ||
        (typeof raw.alarm === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.alarm))
      ) ||
      typeof raw.position !== 'number' ||
      !Number.isFinite(raw.position) ||
      !timestamp(raw.createdAt)
    )
      throw invalid()
    if (raw.status === 'open') {
      if (raw.archivedAs !== null || raw.archivedAt !== null) throw invalid()
    } else if (
      raw.status !== 'archived' ||
      (raw.archivedAs !== 'done' && raw.archivedAs !== 'deleted') ||
      !timestamp(raw.archivedAt)
    )
      throw invalid()
    const repeat = normalizeRule(raw.repeat)
    if (raw.repeat !== null) {
      if (!record(raw.repeat) || !repeat) throw invalid()
      const r = raw.repeat
      if (repeat.kind === 'monthly') {
        if (r.dayOfMonth !== repeat.dayOfMonth) throw invalid()
      } else {
        if (r.interval !== repeat.interval) throw invalid()
        if (
          repeat.kind === 'weekly' &&
          (!Array.isArray(r.days) ||
            r.days.length !== repeat.days.length ||
            r.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6))
        )
          throw invalid()
      }
    }
    const fields = toBody(raw as unknown as TaskFields) as unknown as TaskFields
    return {
      task: { ...fields, repeat, id: raw.id, photo: null, updated: '' } as Task,
      photo: photoBlob(raw.photo),
    }
  })
  return store.importTasks(entries)
}
