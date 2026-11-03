// v1 JSON backup (Settings → export) -> v2 `tasks` records. Pure, no network.
//
// The rules match web/src/lib/repeat.ts normalizeRule; v1 data only ever had
// these shapes.

const ID = /^[a-z0-9]{8,32}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const LEGACY_DAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

const interval = (v) => {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 52) : 1
}
const weekdays = (v) =>
  Array.isArray(v) ? [...new Set(v.map((d) => Math.trunc(Number(d))).filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b) : []

export function normalizeRule(raw, legacy) {
  if (raw && typeof raw === 'object') {
    if (raw.kind === 'daily') return { kind: 'daily', interval: interval(raw.interval) }
    if (raw.kind === 'weekly') {
      const days = weekdays(raw.days)
      if (days.length) return { kind: 'weekly', days, interval: interval(raw.interval) }
    }
    if (raw.kind === 'monthly') {
      const dayOfMonth = Math.trunc(Number(raw.dayOfMonth))
      if (dayOfMonth >= 1 && dayOfMonth <= 31) return { kind: 'monthly', dayOfMonth }
    }
    if (raw.kind) return null
  }
  const days = weekdays(String(legacy ?? '').split(',').map((s) => LEGACY_DAYS[s.trim()] ?? -1))
  return days.length ? { kind: 'weekly', days, interval: 1 } : null
}

function alarmTime(v) {
  const m = typeof v === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(v.trim()) : null
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

function photo(v) {
  const m = typeof v === 'string' ? /^data:([^;,]+);base64,(.*)$/s.exec(v) : null
  return m ? { type: m[1], bytes: Buffer.from(m[2], 'base64') } : null
}

/** { tasks: [{ id, fields, photo }], skipped: [{ index, id, reason }], warnings: string[] } */
export function mapBackup(rows) {
  if (!Array.isArray(rows)) throw new Error('backup must be a JSON array of tasks')
  const tasks = []
  const skipped = []
  const warnings = []
  const seen = new Set()

  rows.forEach((row, index) => {
    const id = row?.id
    const title = typeof row?.title === 'string' ? row.title.trim() : ''
    const reason = !ID.test(id ?? '') ? 'invalid id' : !title ? 'empty title' : seen.has(id) ? 'duplicate id' : null
    if (reason) return skipped.push({ index, id, reason })
    seen.add(id)

    const date = typeof row.dueDate === 'string' && DAY.test(row.dueDate) ? row.dueDate : null
    if (row.dueDate && !date) warnings.push(`${id}: dropped unreadable date ${JSON.stringify(row.dueDate)}`)
    const alarm = alarmTime(row.alarm)
    if (row.alarm && !alarm) warnings.push(`${id}: dropped unreadable alarm ${JSON.stringify(row.alarm)}`)

    let image = photo(row.photo)
    if (row.photo && !image) warnings.push(`${id}: photo is not a data URL, not migrated`)
    if (image && !PHOTO_TYPES.has(image.type)) {
      warnings.push(`${id}: photo type ${image.type} is not accepted by the server, not migrated`)
      image = null
    }

    // v2 titles hold 500 characters. A longer one was a note typed into the
    // title: keep its first line as the title and the whole text in the note.
    let shortTitle = title
    let note = typeof row.detail === 'string' ? row.detail : ''
    if (title.length > 500) {
      const line = title.split('\n')[0].trim()
      shortTitle = line.length > 500 ? `${line.slice(0, 499)}…` : line
      note = note ? `${title}\n\n${note}` : title
      warnings.push(`${id}: title of ${title.length} characters moved into the note`)
    }

    const createdAt = Date.parse(row.createdDate) || Date.parse(row.lastEditedDate) || Date.now()
    const done = row.completed === true
    tasks.push({
      id,
      fields: {
        title: shortTitle,
        note,
        date,
        alarm,
        repeat: normalizeRule(row.repeatRule, row.repeats),
        position: index, // the export lists tasks in the manual order
        status: done ? 'archived' : 'open',
        archivedAs: done ? 'done' : null,
        archivedAt: done ? Date.parse(row.lastEditedDate) || createdAt : null,
        doneOn: null,
        createdAt,
      },
      photo: image,
    })
  })
  return { tasks, skipped, warnings }
}
