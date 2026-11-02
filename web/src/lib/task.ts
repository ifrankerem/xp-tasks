// The task model and the rules on it. Pure: no storage, no network.

import { dayKey, isDay, parseDay, addDays, today, type Day } from './day'
import { nextOccurrence, normalizeRule, occursOn, type RepeatRule } from './repeat'

export interface Task {
  id: string
  title: string
  note: string
  /** Server file name; a photo not uploaded yet lives in the local `photos` table. */
  photo: string | null
  date: Day | null
  /** Local 'HH:MM'. */
  alarm: string | null
  repeat: RepeatRule | null
  /** Manual order, ascending. */
  position: number
  status: 'open' | 'archived'
  archivedAs: 'done' | 'deleted' | null
  archivedAt: number | null
  /** Last completed occurrence of a repeating task. */
  doneOn: Day | null
  createdAt: number
  /** Server `updated`; '' until the server has the task. */
  updated: string
}

/** Fields the app writes. Everything else is set by the server or the sync. */
export type TaskFields = Omit<Task, 'id' | 'photo' | 'updated'>
const FIELDS: (keyof TaskFields)[] = [
  'title', 'note', 'date', 'alarm', 'repeat', 'position', 'status', 'archivedAs', 'archivedAt', 'doneOn', 'createdAt',
]

/** The day a task's repeats count from: its date, or the day it was created. */
export function anchorOf(task: Task): Day {
  return task.date ?? dayKey(new Date(task.createdAt))
}

export function occursOnDay(task: Task, day: Day): boolean {
  if (task.status !== 'open') return false
  return task.repeat ? occursOn(task.repeat, anchorOf(task), day) : task.date === day
}

/** The occurrence "Tamamlandı" means: today if it occurs today, otherwise the next one. */
export function currentOccurrence(task: Task, day: Day): Day | null {
  return task.repeat ? nextOccurrence(task.repeat, anchorOf(task), day) : task.date
}

export function isOccurrenceDone(task: Task, day: Day): boolean {
  const current = currentOccurrence(task, day)
  return Boolean(task.repeat && task.doneOn && current && task.doneOn >= current)
}

// Every patch below sets absolute values, so a retried or doubled write lands
// on the same state. Nothing toggles.

/** Tamamlandı. `occurrence` is the day an alarm rang for, when it comes from one. */
export function completionPatch(task: Task, now: Date, occurrence?: Day): Partial<TaskFields> {
  if (task.repeat) return { doneOn: occurrence ?? currentOccurrence(task, today(now)) }
  return { status: 'archived', archivedAs: 'done', archivedAt: now.getTime() }
}

/** Sil: moves any task to Arşiv. Only Kalıcı sil removes it. */
export function deletionPatch(now: Date): Partial<TaskFields> {
  return { status: 'archived', archivedAs: 'deleted', archivedAt: now.getTime() }
}

export function restorePatch(): Partial<TaskFields> {
  return { status: 'open', archivedAs: null, archivedAt: null }
}

function alarmTime(alarm: string | null): [number, number] | null {
  const m = alarm ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(alarm) : null
  return m ? [Number(m[1]), Number(m[2])] : null
}

/** When the task's alarm rings next (epoch ms), or null when it will not. */
export function nextAlarm(task: Task, now: Date): number | null {
  const time = alarmTime(task.alarm)
  if (task.status !== 'open' || !time) return null
  const ringAt = (day: Day) => {
    const d = parseDay(day)
    d.setHours(time[0], time[1], 0, 0)
    return d.getTime()
  }

  if (!task.repeat) {
    const at = ringAt(anchorOf(task))
    return at > now.getTime() ? at : null
  }

  const anchor = anchorOf(task)
  let day = nextOccurrence(task.repeat, anchor, today(now))
  // At most a done occurrence and today's passed one stand in the way.
  for (let i = 0; day && i < 3; i++) {
    if ((!task.doneOn || day > task.doneOn) && ringAt(day) > now.getTime()) return ringAt(day)
    day = nextOccurrence(task.repeat, anchor, addDays(day, 1))
  }
  return null
}

const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v !== 0 ? v : null)

/** A task from a PocketBase record, where empty means '' or 0. */
export function fromRecord(r: Record<string, unknown>): Task {
  const date = str(r.date)
  const doneOn = str(r.doneOn)
  return {
    id: String(r.id),
    title: String(r.title ?? ''),
    note: String(r.note ?? ''),
    photo: str(r.photo),
    date: isDay(date) ? date : null,
    alarm: alarmTime(str(r.alarm)) ? str(r.alarm) : null,
    repeat: normalizeRule(r.repeat),
    position: typeof r.position === 'number' ? r.position : 0,
    status: r.status === 'archived' ? 'archived' : 'open',
    archivedAs: r.archivedAs === 'done' || r.archivedAs === 'deleted' ? r.archivedAs : null,
    archivedAt: num(r.archivedAt),
    doneOn: isDay(doneOn) ? doneOn : null,
    createdAt: num(r.createdAt) ?? 0,
    updated: String(r.updated ?? ''),
  }
}

/** A request body with only the writable fields that are present. */
export function toBody(patch: Partial<TaskFields>): Record<string, unknown> {
  return Object.fromEntries(FIELDS.filter((k) => k in patch).map((k) => [k, patch[k]]))
}
