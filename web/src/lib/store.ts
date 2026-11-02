// The local store: the only thing the UI writes to. Each write changes the task
// row and appends its outbox entry in one IndexedDB transaction, so a change is
// either fully saved on the device or not at all, whatever the network does.

import Dexie, { type Table } from 'dexie'
import { today, type Day } from './day'
import type { RepeatRule } from './repeat'
import { completionPatch, deletionPatch, restorePatch, toBody, type Task, type TaskFields } from './task'

export interface OutboxEntry {
  seq?: number
  taskId: string
  kind: 'create' | 'update' | 'delete'
  body: Record<string, unknown>
  /** Blob: set this photo. null: remove it. Absent: leave it. */
  photo?: Blob | null
}

/** A photo not uploaded yet, shown in place of the server copy. */
export interface LocalPhoto {
  taskId: string
  blob: Blob
  /** Outbox entry that uploads it. */
  seq: number
}

class XpDb extends Dexie {
  tasks!: Table<Task, string>
  outbox!: Table<OutboxEntry, number>
  /** Ids removed for good. Nothing with these ids is ever stored again. */
  tombstones!: Table<{ id: string }, string>
  photos!: Table<LocalPhoto, string>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      tasks: 'id, status, position',
      outbox: '++seq, taskId',
      tombstones: 'id',
      photos: 'taskId',
    })
  }
}

export type Editable = Partial<Pick<TaskFields, 'title' | 'note' | 'date' | 'alarm' | 'repeat'>>

export interface NewTask {
  title: string
  note?: string
  date?: Day | null
  alarm?: string | null
  repeat?: RepeatRule | null
  photo?: Blob | null
}

export const BIRTHDAY_TITLE = 'İrfan Kerem Arslan DOGUM GÜNÜ'

/** 15 characters of [a-z0-9], like PocketBase's own ids. */
export function newId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(15)), (b) => chars[b % 36]).join('')
}

export class Store {
  readonly db: XpDb
  private listeners = new Set<() => void>()

  constructor(name = 'xp-tasks') {
    this.db = new XpDb(name)
  }

  /** Called after every local write; the sync loop uses it to push soon. */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private async write(fn: () => Promise<void>) {
    const { tasks, outbox, tombstones, photos } = this.db
    await this.db.transaction('rw', [tasks, outbox, tombstones, photos], fn)
    this.listeners.forEach((cb) => cb())
  }

  private async topPosition() {
    const first = await this.db.tasks.orderBy('position').first()
    return first ? first.position - 1 : 0
  }

  private async queue(entry: OutboxEntry) {
    const seq = await this.db.outbox.add(entry)
    if (entry.photo) await this.db.photos.put({ taskId: entry.taskId, blob: entry.photo, seq })
    else if (entry.photo === null) await this.db.photos.delete(entry.taskId)
  }

  private async patch(id: string, fields: Partial<TaskFields>, photo?: Blob | null) {
    const task = await this.db.tasks.get(id)
    if (!task) return
    await this.db.tasks.put({ ...task, ...fields, ...(photo === null ? { photo: null } : {}) })
    await this.queue({ taskId: id, kind: 'update', body: toBody(fields), ...(photo !== undefined ? { photo } : {}) })
  }

  async create(input: NewTask, now = new Date(), id = newId()): Promise<Task> {
    let task!: Task
    await this.write(async () => {
      task = await this.insert(input, now, id)
    })
    return task
  }

  private async insert(input: NewTask, now: Date, id: string): Promise<Task> {
    const task: Task = {
      id,
      title: input.title,
      note: input.note ?? '',
      photo: null,
      date: input.date ?? null,
      alarm: input.alarm ?? null,
      repeat: input.repeat ?? null,
      position: await this.topPosition(),
      status: 'open',
      archivedAs: null,
      archivedAt: null,
      doneOn: null,
      createdAt: now.getTime(),
      updated: '',
    }
    await this.db.tasks.add(task)
    await this.queue({ taskId: id, kind: 'create', body: toBody(task), ...(input.photo ? { photo: input.photo } : {}) })
    return task
  }

  /** Edit form save. `photo`: Blob replaces, null removes, undefined keeps. */
  update(id: string, fields: Editable, photo?: Blob | null) {
    return this.write(() => this.patch(id, fields, photo))
  }

  /** Tamamlandı. `occurrence` is the day an alarm rang for, if it came from one. */
  complete(id: string, now = new Date(), occurrence?: Day) {
    return this.write(async () => {
      const task = await this.db.tasks.get(id)
      if (task) await this.patch(id, completionPatch(task, now, occurrence))
    })
  }

  /** Sil: to Arşiv. */
  remove(id: string, now = new Date()) {
    return this.write(() => this.patch(id, deletionPatch(now)))
  }

  /** Geri getir. */
  restore(id: string) {
    return this.write(() => this.patch(id, restorePatch()))
  }

  /** Kalıcı sil: the record and its photo, for good. */
  purge(id: string) {
    return this.write(async () => {
      await this.db.tasks.delete(id)
      await this.db.photos.delete(id)
      await this.db.tombstones.put({ id })
      // Queued writes for it are pointless now. The delete is sent even if the
      // server never saw the task, in case its create is in flight right now.
      await this.db.outbox.where('taskId').equals(id).delete()
      await this.db.outbox.add({ taskId: id, kind: 'delete', body: {} })
    })
  }

  /** Drag and drop: put `id` between the tasks shown above and below it. */
  move(id: string, aboveId: string | null, belowId: string | null) {
    return this.write(async () => {
      const position = async (other: string | null) => (other ? (await this.db.tasks.get(other))?.position ?? null : null)
      let above = await position(aboveId)
      let below = await position(belowId)
      if (above !== null && below !== null && below - above < 1e-9) {
        // Out of room between two numbers: space every task out again, once.
        const all = await this.db.tasks.orderBy('position').toArray()
        for (const [i, t] of all.entries()) if (t.position !== i) await this.patch(t.id, { position: i })
        above = await position(aboveId)
        below = await position(belowId)
      }
      const next =
        above !== null && below !== null ? (above + below) / 2 : above !== null ? above + 1 : below !== null ? below - 1 : 0
      await this.patch(id, { position: next })
    })
  }

  /**
   * The yearly birthday task for the coming 20 December. Its id is fixed per
   * year, so devices that make it at the same time end up with one record.
   */
  ensureBirthday(now = new Date()) {
    const year = today(now) > `${now.getFullYear()}-12-20` ? now.getFullYear() + 1 : now.getFullYear()
    const id = `birthday${year}`
    return this.write(async () => {
      if ((await this.db.tasks.get(id)) || (await this.db.tombstones.get(id))) return
      await this.insert({ title: BIRTHDAY_TITLE, date: `${year}-12-20` }, now, id)
    })
  }
}
