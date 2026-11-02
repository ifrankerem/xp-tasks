import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Store } from './lib/store'
import { TaskPhoto } from './task-photo'

export function ArchiveScreen({ store }: { store: Store }) {
  const tasks = useLiveQuery(
    () => store.db.tasks.where('status').equals('archived').sortBy('position'),
    [store],
  )
  const [filter, setFilter] = useState<'all' | 'done' | 'deleted'>('all')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const write = async (id: string, title: string, purge: boolean) => {
    if (pending.current) return
    if (
      purge &&
      !window.confirm(`“${title}” kalıcı olarak silinsin mi? Görev ve fotoğrafı geri getirilemez.`)
    )
      return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      if (purge) await store.purge(id)
      else await store.restore(id)
    } catch {
      setError('Değişiklik kaydedilemedi. Yeniden deneyin.')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const visible = (tasks ?? []).filter((task) => filter === 'all' || task.archivedAs === filter)
  return (
    <section>
      <header className="page-header">
        <h1>Arşiv</h1>
        <a className="icon-button" href="#/ayarlar" aria-label="Ayarlar">
          ⚙
        </a>
      </header>
      <p className="section-description">Bitirdiklerin ve kenara ayırdıkların.</p>
      <div className="archive-filters" role="group" aria-label="Arşiv filtresi">
        {(
          [
            ['all', 'Tümü'],
            ['done', 'Tamamlananlar'],
            ['deleted', 'Silinenler'],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}{' '}
            <span>
              {(tasks ?? []).filter((task) => value === 'all' || task.archivedAs === value).length}
            </span>
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!tasks ? (
        <p role="status">Arşiv açılıyor…</p>
      ) : !visible.length ? (
        <div className="empty-state">
          <p>{tasks.length ? 'Bu bölümde görev yok.' : 'Arşivin boş.'}</p>
        </div>
      ) : (
        <ul className="archive-list" aria-label="Arşivlenen görevler">
          {visible.map((task) => (
            <li className="archive-card" key={task.id}>
              <div className="archive-summary">
                <a
                  className="task-content"
                  href={`#/gorev/${task.id}`}
                  aria-label={`${task.title}: aç`}
                >
                  <span className="task-title">{task.title}</span>
                  <span
                    className={`task-secondary ${task.archivedAs === 'done' ? 'done-text' : ''}`}
                  >
                    {task.archivedAs === 'done' ? 'Tamamlandı' : 'Silindi'}
                  </span>
                </a>
                <TaskPhoto store={store} task={task} />
              </div>
              <div className="archive-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  aria-label={`${task.title}: geri getir`}
                  onClick={() => {
                    void write(task.id, task.title, false)
                  }}
                >
                  Geri getir
                </button>
                <button
                  type="button"
                  className="secondary-button delete-button"
                  disabled={busy}
                  aria-label={`${task.title}: kalıcı sil`}
                  onClick={() => {
                    void write(task.id, task.title, true)
                  }}
                >
                  Kalıcı sil
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
