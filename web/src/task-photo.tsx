import { createContext, useContext, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Store } from './lib/store'
import type { Task } from './lib/task'

export const PhotoUrlContext = createContext<
  (task: Pick<Task, 'id' | 'photo'>, large: boolean) => Promise<string>
>(async () => '')

export function TaskPhoto({
  store,
  task,
  replacement,
  large = false,
}: {
  store: Store
  task?: Task
  replacement?: Blob | null
  large?: boolean
}) {
  const pending = useLiveQuery(
    () => (task ? store.db.photos.get(task.id) : undefined),
    [store, task?.id],
  )
  const blob = replacement === undefined ? pending?.blob : replacement
  const [local, setLocal] = useState('')
  const getPhotoUrl = useContext(PhotoUrlContext)
  const [remote, setRemote] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!blob) {
      setLocal('')
      return
    }
    const url = URL.createObjectURL(blob)
    setLocal(url)
    return () => URL.revokeObjectURL(url)
  }, [blob])
  const id = task?.id,
    photo = task?.photo
  useEffect(() => {
    let active = true
    const load = () => {
      if (!id || !photo || blob || replacement === null) {
        setRemote('')
        return
      }
      setFailed(false)
      void getPhotoUrl({ id, photo }, large)
        .then((url) => {
          if (active) setRemote(url)
        })
        .catch(() => {
          if (active) setFailed(true)
        })
    }
    load()
    window.addEventListener('online', load)
    return () => {
      active = false
      window.removeEventListener('online', load)
    }
  }, [id, photo, blob, replacement, large, getPhotoUrl])
  if (replacement === null || (!blob && !photo)) return null
  const src = blob ? local : remote
  if (failed && !blob)
    return (
      <span
        className="photo-unavailable"
        role="img"
        aria-label="Fotoğraf bağlantı kurulunca açılacak"
      >
        ▧
      </span>
    )
  return src ? (
    <img
      className={large ? 'photo-preview' : 'task-photo'}
      src={src}
      alt="Görev fotoğrafı"
      onError={() => setFailed(true)}
    />
  ) : null
}
