import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { validDay } from './lib/calendar'
import { parseDay, today, type Day } from './lib/day'
import type { RepeatRule } from './lib/repeat'
import type { Store } from './lib/store'
import { currentOccurrence, isOccurrenceDone, occursOnDay } from './lib/task'
import { useNow } from './lib/use-now'
import { TaskPhoto } from './task-photo'

function repeatLabel(rule: RepeatRule | null) {
  if (!rule) return 'Tek seferlik'
  if (rule.kind === 'daily') return rule.interval === 1 ? 'Her gün' : `${rule.interval} günde bir`
  if (rule.kind === 'monthly') return `Her ayın ${rule.dayOfMonth}. günü`
  const days = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']
  return `${rule.days.map((day) => days[day]).join(', ')} · ${rule.interval === 1 ? 'her hafta' : `${rule.interval} haftada bir`}`
}

export function TaskPage({
  store,
  taskId,
  occurrence,
  onBack,
  onEdit,
}: {
  store: Store
  taskId: string
  occurrence?: Day
  onBack(): void
  onEdit(): void
}) {
  const task = useLiveQuery(async () => (await store.db.tasks.get(taskId)) ?? null, [store, taskId])
  const now = useNow()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  if (task === undefined) return <p role="status">Görev açılıyor…</p>
  if (!task)
    return (
      <section className="empty-state">
        <h1>Görev bulunamadı</h1>
        <p>Bu görev başka bir cihazdan kaldırılmış olabilir.</p>
        <button type="button" className="secondary-button" onClick={onBack}>
          Geri
        </button>
      </section>
    )
  const selected =
    occurrence && validDay(occurrence) && occursOnDay(task, occurrence)
      ? occurrence
      : currentOccurrence(task, today(now))
  const date = selected ?? task.date
  const done = isOccurrenceDone(task, selected ?? today(now))
  const archived = task.status === 'archived'
  const write = async (action: 'complete' | 'remove') => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      if (action === 'remove') await store.remove(task.id)
      else await store.complete(task.id, new Date(), selected ?? undefined)
      onBack()
    } catch {
      setError('Değişiklik kaydedilemedi. Yeniden deneyin.')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <article className="task-page">
      <header className="detail-header">
        <button type="button" className="icon-button" aria-label="Geri" onClick={onBack}>
          ←
        </button>
        <span>Görev</span>
      </header>
      <h1>{task.title}</h1>
      <div className="detail-chips">
        <span className="detail-chip">
          {date
            ? new Intl.DateTimeFormat('tr', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              }).format(parseDay(date))
            : 'Tarihsiz'}
        </span>
        {task.alarm && <span className="detail-chip alarm-text">⏰ {task.alarm}</span>}
        <span className="detail-chip">{repeatLabel(task.repeat)}</span>
        {done && !archived && (
          <span className="detail-chip done-text">Bu tarih için tamamlandı</span>
        )}
        {archived && (
          <span className="detail-chip">
            Arşivde · {task.archivedAs === 'done' ? 'Tamamlandı' : 'Silindi'}
          </span>
        )}
      </div>
      {task.note && <p className="detail-note">{task.note}</p>}
      <TaskPhoto store={store} task={task} large />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="detail-actions">
        <button
          type="button"
          className="primary-button complete-button"
          disabled={busy || archived || done}
          onClick={() => {
            void write('complete')
          }}
        >
          Tamamlandı
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busy || archived}
          onClick={onEdit}
        >
          Düzenle
        </button>
        <button
          type="button"
          className="secondary-button delete-button"
          disabled={busy || archived}
          onClick={() => {
            void write('remove')
          }}
        >
          Sil
        </button>
      </div>
    </article>
  )
}
