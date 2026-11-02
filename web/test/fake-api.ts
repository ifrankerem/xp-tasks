// An in-memory PocketBase stand-in with the same contract as src/lib/api.ts,
// plus switches to make it fail the way a phone on a bad network does.

import { ApiError, type TaskApi } from '../src/lib/api'
import { fromRecord, type Task } from '../src/lib/task'

export class FakeApi implements TaskApi {
  records = new Map<string, Task>()
  photos = new Map<string, Blob>()
  calls: string[] = []
  offline = false
  /** The server applies the next write but the response never arrives. */
  loseNextResponse = false
  private clock = 0
  private listeners = new Set<(action: 'create' | 'update' | 'delete', task: Task) => void>()

  private stamp() {
    return `2026-11-02 00:00:${String(++this.clock).padStart(2, '0')}.000Z`
  }

  private guard(call: string) {
    this.calls.push(call)
    if (this.offline) throw new ApiError('network', 'offline')
  }

  private respond<T>(value: T): T {
    if (this.loseNextResponse) {
      this.loseNextResponse = false
      throw new ApiError('network', 'response lost')
    }
    return value
  }

  private emit(action: 'create' | 'update' | 'delete', task: Task) {
    for (const cb of this.listeners) cb(action, structuredClone(task))
  }

  /** A change made by another device. */
  remoteWrite(task: Task) {
    const saved = { ...task, updated: this.stamp() }
    const action = this.records.has(task.id) ? 'update' : 'create'
    this.records.set(task.id, saved)
    this.emit(action, saved)
  }

  remoteDelete(id: string) {
    const task = this.records.get(id)
    this.records.delete(id)
    if (task) this.emit('delete', task)
  }

  async list() {
    this.guard('list')
    return [...this.records.values()].map((t) => structuredClone(t))
  }

  async create(id: string, body: Record<string, unknown>, photo?: Blob | null) {
    this.guard(`create ${id}`)
    if (this.records.has(id)) throw new ApiError('duplicate', 'Value must be unique.')
    const task = fromRecord({ ...body, id, photo: photo ? `${id}.jpg` : '', updated: this.stamp() })
    if (photo) this.photos.set(id, photo)
    this.records.set(id, task)
    this.emit('create', task)
    return this.respond(structuredClone(task))
  }

  async update(id: string, body: Record<string, unknown>, photo?: Blob | null) {
    this.guard(`update ${id} ${Object.keys(body).sort().join(',')}${photo !== undefined ? ' +photo' : ''}`)
    const current = this.records.get(id)
    if (!current) throw new ApiError('notFound', 'not found')
    const task: Task = { ...current, ...fromRecord({ ...current, ...body, updated: this.stamp() }) }
    if (photo) {
      this.photos.set(id, photo)
      task.photo = `${id}-${this.clock}.jpg`
    } else if (photo === null) {
      this.photos.delete(id)
      task.photo = null
    }
    this.records.set(id, task)
    this.emit('update', task)
    return this.respond(structuredClone(task))
  }

  async remove(id: string) {
    this.guard(`delete ${id}`)
    const task = this.records.get(id)
    if (!task) throw new ApiError('notFound', 'not found')
    this.records.delete(id)
    this.photos.delete(id)
    this.emit('delete', task)
    return this.respond(undefined)
  }

  async subscribe(cb: (action: 'create' | 'update' | 'delete', task: Task) => void) {
    this.listeners.add(cb)
    return async () => {
      this.listeners.delete(cb)
    }
  }
}
