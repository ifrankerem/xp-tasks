// The only module that talks to PocketBase. Everything above it sees plain
// Tasks and five kinds of failure.

import type PocketBase from 'pocketbase'
import { ClientResponseError } from 'pocketbase'
import { fromRecord, type Task } from './task'

export type ApiErrorKind = 'network' | 'auth' | 'notFound' | 'duplicate' | 'invalid'

export class ApiError extends Error {
  constructor(readonly kind: ApiErrorKind, message: string) {
    super(message)
  }
}

export interface TaskApi {
  list(): Promise<Task[]>
  /** `id` is made on the client; a second create with it fails as 'duplicate'. */
  create(id: string, body: Record<string, unknown>, photo?: Blob | null): Promise<Task>
  /** `photo`: a Blob replaces it, null removes it, undefined leaves it. */
  update(id: string, body: Record<string, unknown>, photo?: Blob | null): Promise<Task>
  remove(id: string): Promise<void>
  subscribe(cb: (action: 'create' | 'update' | 'delete', task: Task) => void): Promise<() => Promise<void>>
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (!(error instanceof ClientResponseError)) return new ApiError('network', String(error))
  const { status } = error
  const data = error.response?.data as Record<string, { code?: string }> | undefined
  if (status === 0 || status === 429 || status >= 500) return new ApiError('network', error.message)
  if (status === 401 || status === 403) return new ApiError('auth', error.message)
  if (status === 404) return new ApiError('notFound', error.message)
  if (status === 400 && data?.id?.code === 'validation_not_unique') return new ApiError('duplicate', error.message)
  return new ApiError('invalid', `${error.message} ${JSON.stringify(data ?? {})}`)
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    throw toApiError(error)
  }
}

/** JSON body, or multipart when a photo is added or removed. */
function payload(body: Record<string, unknown>, photo: Blob | null | undefined) {
  if (photo === undefined) return body
  const form = new FormData()
  for (const [key, value] of Object.entries(body)) {
    form.append(key, value !== null && typeof value === 'object' ? JSON.stringify(value) : value === null ? '' : String(value))
  }
  if (photo) form.append('photo', photo, 'photo.jpg')
  else form.append('photo', '')
  return form
}

export function pocketbaseApi(pb: PocketBase): TaskApi {
  const tasks = () => pb.collection('tasks')
  const owner = () => {
    const id = pb.authStore.record?.id
    if (!id) throw new ApiError('auth', 'not signed in')
    return id
  }

  return {
    list: () =>
      call(async () => {
        // PocketBase answers a bad or expired token as a guest: 200 and no
        // tasks, which a pull would read as "everything was deleted". The
        // refresh fails with 401 instead, and renews the token as a bonus.
        await pb.collection('users').authRefresh({ requestKey: null })
        return (await tasks().getFullList({ batch: 500, requestKey: null })).map(fromRecord)
      }),
    create: (id, body, photo) =>
      call(async () => fromRecord(await tasks().create(payload({ ...body, id, owner: owner() }, photo ?? undefined), { requestKey: null }))),
    update: (id, body, photo) => call(async () => fromRecord(await tasks().update(id, payload(body, photo), { requestKey: null }))),
    remove: (id) =>
      call(async () => {
        await tasks().delete(id, { requestKey: null })
      }),
    subscribe: (cb) =>
      call(async () => {
        const stop = await tasks().subscribe('*', (e) => cb(e.action as 'create' | 'update' | 'delete', fromRecord(e.record)))
        return async () => {
          await stop()
        }
      }),
  }
}
