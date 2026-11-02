// Moves changes between the local store and the server.
//
//   push: send outbox entries in order; an entry leaves the outbox only once
//         the server has it (or can never take it).
//   pull: take the server copy of every task that has nothing waiting in the
//         outbox. Local changes win until they are sent; after that the
//         server copy wins (last write wins).
//
// Ids in `tombstones` were deleted for good and are never stored again.

import { ApiError, type TaskApi } from './api'
import type { OutboxEntry, Store } from './store'
import type { Task } from './task'

export type SyncResult = 'ok' | 'offline' | 'auth'

export class Sync {
  /** Last write the server refused outright; shown in Ayarlar. */
  lastError: string | null = null
  private running: Promise<SyncResult> | null = null
  private again = false
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private store: Store, private api: TaskApi) {}

  private get db() {
    return this.store.db
  }

  /** Push, then pull. A call during a run asks for one more run after it. */
  run(): Promise<SyncResult> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      let result: SyncResult
      do {
        this.again = false
        result = await this.push()
        if (result === 'ok') result = await this.pull()
      } while (this.again && result === 'ok')
      return result
    })().finally(() => {
      this.running = null
    })
    return this.running
  }

  private send(entry: OutboxEntry): Promise<Task | void> {
    if (entry.kind === 'create') return this.api.create(entry.taskId, entry.body, entry.photo)
    if (entry.kind === 'update') return this.api.update(entry.taskId, entry.body, entry.photo)
    return this.api.remove(entry.taskId)
  }

  async push(): Promise<SyncResult> {
    for (;;) {
      const entry = await this.db.outbox.orderBy('seq').first()
      if (!entry) return 'ok'
      try {
        const saved = await this.send(entry)
        await this.sent(entry, saved || undefined)
      } catch (e) {
        const error = e instanceof ApiError ? e : new ApiError('network', String(e))
        if (error.kind === 'network') return 'offline'
        if (error.kind === 'auth') return 'auth'
        if (error.kind === 'duplicate' || (error.kind === 'notFound' && entry.kind === 'delete')) {
          await this.sent(entry) // the server already has this write
        } else if (error.kind === 'notFound') {
          await this.forget(entry.taskId) // deleted for good on another device
        } else {
          this.lastError = error.message
          await this.sent(entry) // invalid: retrying cannot help; the next pull restores the server copy
        }
      }
    }
  }

  private sent(entry: OutboxEntry, saved?: Task) {
    const { tasks, outbox, tombstones, photos } = this.db
    return this.db.transaction('rw', [tasks, outbox, tombstones, photos], async () => {
      await outbox.delete(entry.seq!)
      if ((await photos.get(entry.taskId))?.seq === entry.seq) await photos.delete(entry.taskId)
      if (saved && !(await this.pending(entry.taskId)) && !(await tombstones.get(saved.id))) await tasks.put(saved)
    })
  }

  private async pending(id: string) {
    return (await this.db.outbox.where('taskId').equals(id).count()) > 0
  }

  private forget(id: string) {
    const { tasks, outbox, tombstones, photos } = this.db
    return this.db.transaction('rw', [tasks, outbox, tombstones, photos], async () => {
      await outbox.where('taskId').equals(id).delete()
      await tasks.delete(id)
      await photos.delete(id)
      await tombstones.put({ id })
    })
  }

  // shortcut: pulls the whole list each time (fine for a few hundred tasks);
  // switch to `updated >` filtering plus an id-only list if it grows large.
  async pull(): Promise<SyncResult> {
    let remote: Task[]
    try {
      remote = await this.api.list()
    } catch (e) {
      return e instanceof ApiError && e.kind === 'auth' ? 'auth' : 'offline'
    }
    for (const task of remote) await this.applyRemote(task)

    const onServer = new Set(remote.map((t) => t.id))
    for (const local of await this.db.tasks.toArray()) {
      if (!onServer.has(local.id)) await this.applyRemoteDelete(local.id)
    }
    return 'ok'
  }

  /** A server copy from a pull or a realtime event. */
  applyRemote(task: Task) {
    const { tasks, outbox, tombstones } = this.db
    return this.db.transaction('rw', [tasks, outbox, tombstones], async () => {
      if (await this.pending(task.id)) return
      if (await tombstones.get(task.id)) {
        // Deleted here for good, but the server still has it: delete it again.
        await outbox.add({ taskId: task.id, kind: 'delete', body: {} })
        return
      }
      await tasks.put(task)
    })
  }

  applyRemoteDelete(id: string) {
    const { tasks, outbox, tombstones, photos } = this.db
    return this.db.transaction('rw', [tasks, outbox, tombstones, photos], async () => {
      if (await this.pending(id)) return // the push settles it
      await tasks.delete(id)
      await photos.delete(id)
      await tombstones.put({ id })
    })
  }

  /** Apply realtime events in arrival order. Returns the unsubscribe. */
  listen() {
    return this.api.subscribe((action, task) => {
      this.chain = this.chain
        .then(() => (action === 'delete' ? this.applyRemoteDelete(task.id) : this.applyRemote(task)))
        .catch((e) => {
          this.lastError = String(e)
        })
    })
  }

  /** Resolves once queued realtime events are applied. */
  idle() {
    return this.chain
  }
}

/**
 * Keeps a device in sync: runs on start, shortly after local writes, when the
 * network or the app comes back, and every 30 s while something is unsent.
 */
export function startSync(sync: Sync, store: Store, onResult: (result: SyncResult) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const run = () => {
    if (stopped) return
    clearTimeout(timer)
    void sync.run().then(async (result) => {
      if (stopped) return
      onResult(result)
      const retry = result !== 'ok' || (await store.db.outbox.count()) > 0
      if (!stopped && retry) timer = setTimeout(run, 30_000)
    })
  }
  const soon = () => {
    clearTimeout(timer)
    timer = setTimeout(run, 300)
  }
  const visible = () => {
    if (document.visibilityState === 'visible') run()
  }

  const offChange = store.onChange(soon)
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', visible)
  const unsubscribe = sync.listen().catch(() => undefined)
  run()

  return () => {
    stopped = true
    clearTimeout(timer)
    offChange()
    window.removeEventListener('online', run)
    document.removeEventListener('visibilitychange', visible)
    void unsubscribe.then((stop) => stop?.())
  }
}
