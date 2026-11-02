import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { prepareTask } from './lib/form'
import { compressPhoto } from './lib/photo'
import type { RepeatRule } from './lib/repeat'
import type { Editable, NewTask, Store } from './lib/store'
import type { Task } from './lib/task'
import { TaskPhoto } from './task-photo'

export function TaskForm(props: {
  store: Store
  taskId?: string
  onSaved(task: Task): void
  onCancel(): void
}) {
  const record = useLiveQuery(
    async () => (props.taskId ? ((await props.store.db.tasks.get(props.taskId)) ?? null) : null),
    [props.store, props.taskId],
  )
  if (props.taskId && record === undefined) return <p role="status">Görev açılıyor…</p>
  if (props.taskId && !record)
    return (
      <section className="empty-state">
        <h1>Görev bulunamadı</h1>
        <button onClick={props.onCancel}>Geri dön</button>
      </section>
    )
  return <FormFields key={props.taskId ?? 'new'} {...props} task={record ?? undefined} />
}

function FormFields({
  store,
  task,
  onSaved,
  onCancel,
}: {
  store: Store
  task?: Task
  onSaved(task: Task): void
  onCancel(): void
}) {
  const [initial] = useState(task)
  const [title, setTitle] = useState(task?.title ?? '')
  const [note, setNote] = useState(task?.note ?? '')
  const [date, setDate] = useState(task?.date ?? '')
  const [alarm, setAlarm] = useState(task?.alarm ?? '')
  const [kind, setKind] = useState<RepeatRule['kind'] | 'none'>(task?.repeat?.kind ?? 'none')
  const [interval, setInterval] = useState(
    task?.repeat && task.repeat.kind !== 'monthly' ? task.repeat.interval : 1,
  )
  const [days, setDays] = useState<readonly number[]>(
    task?.repeat?.kind === 'weekly' ? task.repeat.days : [new Date().getDay()],
  )
  const [dayOfMonth, setDayOfMonth] = useState(
    task?.repeat?.kind === 'monthly' ? task.repeat.dayOfMonth : 1,
  )
  const [photo, setPhoto] = useState<Blob | null | undefined>()
  const [processing, setProcessing] = useState(false)
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)
  const [error, setError] = useState('')
  const choosePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    setProcessing(true)
    try {
      setPhoto(await compressPhoto(file))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Fotoğraf işlenemedi.')
    } finally {
      setProcessing(false)
    }
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting.current || processing) return
    submitting.current = true
    setSaving(true)
    setError('')
    try {
      const repeat: RepeatRule | null =
        kind === 'none'
          ? null
          : kind === 'daily'
            ? { kind, interval }
            : kind === 'weekly'
              ? { kind, interval, days: [...days].sort() }
              : { kind, dayOfMonth }
      const values = prepareTask(
        { title, note, date: date || null, alarm: alarm || null, repeat },
        new Date(),
      )
      let saved: Task
      if (initial) {
        const patch: Editable = {}
        for (const key of ['title', 'note', 'date', 'alarm', 'repeat'] as const) {
          if (JSON.stringify(values[key]) !== JSON.stringify(initial[key]))
            Object.assign(patch, { [key]: values[key] })
        }
        if (Object.keys(patch).length || photo !== undefined)
          await store.update(initial.id, patch, photo)
        const current = await store.db.tasks.get(initial.id)
        if (!current) throw new Error('Görev artık bulunamıyor.')
        saved = current
      } else saved = await store.create({ ...values, photo } as NewTask)
      onSaved(saved)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Görev kaydedilemedi. Yeniden deneyin.')
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }
  const hasPhoto = photo !== null && (photo || task?.photo)
  return (
    <section className="form-page">
      <header className="page-header">
        <button
          type="button"
          className="icon-button back-button"
          aria-label="Geri"
          onClick={onCancel}
        >
          ←
        </button>
        <h1>{task ? 'Görevi düzenle' : 'Yeni görev'}</h1>
      </header>
      <form
        onSubmit={(event) => {
          void save(event)
        }}
      >
        <label className="field-label">
          Görev adı
          <input
            autoFocus
            required
            maxLength={500}
            placeholder="Aklında ne var?"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="field-label">
          Not <span className="optional">isteğe bağlı</span>
          <textarea
            rows={4}
            maxLength={20000}
            placeholder="Ayrıntılar, küçük hatırlatmalar…"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <fieldset className="photo-field">
          <legend>Fotoğraf</legend>
          <TaskPhoto store={store} task={task} replacement={photo} large />
          <div className="photo-actions">
            <label className="secondary-button">
              Fotoğraf seç
              <input
                className="sr-only"
                type="file"
                accept="image/*"
                aria-label="Fotoğraf seç"
                disabled={processing || saving}
                onChange={(event) => {
                  void choosePhoto(event)
                }}
              />
            </label>
            <label className="secondary-button">
              Kamera
              <input
                className="sr-only"
                type="file"
                accept="image/*"
                capture="environment"
                aria-label="Kamera"
                disabled={processing || saving}
                onChange={(event) => {
                  void choosePhoto(event)
                }}
              />
            </label>
            <button
              type="button"
              className="text-button danger-text"
              onClick={() => setPhoto(null)}
              disabled={processing || saving}
            >
              Fotoğrafı kaldır
            </button>
          </div>
          {processing && <p role="status">Fotoğraf hazırlanıyor…</p>}
          {hasPhoto ? null : <p className="field-hint">Bir fotoğraf ekleyebilirsin.</p>}
        </fieldset>
        <div className="field-pair">
          <label className="field-label">
            Tarih
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="field-label">
            Alarm
            <input type="time" value={alarm} onChange={(event) => setAlarm(event.target.value)} />
          </label>
        </div>
        <div className="clear-fields">
          <button type="button" className="text-button" onClick={() => setDate('')}>
            Tarihi kaldır
          </button>
          <button type="button" className="text-button" onClick={() => setAlarm('')}>
            Alarmı kaldır
          </button>
        </div>
        {alarm && !date && kind === 'none' && (
          <p className="field-hint">
            Alarm, bu saatin bir sonraki gelişine ayarlanır: bugün ya da yarın.
          </p>
        )}
        <label className="field-label">
          Tekrar
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="none">Tekrarlama</option>
            <option value="daily">Günlük</option>
            <option value="weekly">Haftalık</option>
            <option value="monthly">Aylık</option>
          </select>
        </label>
        {(kind === 'daily' || kind === 'weekly') && (
          <label className="field-label">
            Tekrar aralığı
            <input
              type="number"
              min={1}
              max={52}
              step={1}
              required
              value={Number.isNaN(interval) ? '' : interval}
              onChange={(event) => setInterval(event.target.valueAsNumber)}
            />
            <span className="field-hint">{kind === 'daily' ? 'günde bir' : 'haftada bir'}</span>
          </label>
        )}
        {kind === 'weekly' && (
          <fieldset className="weekdays">
            <legend>Haftanın günleri</legend>
            {[
              [1, 'Pzt'],
              [2, 'Sal'],
              [3, 'Çar'],
              [4, 'Per'],
              [5, 'Cum'],
              [6, 'Cmt'],
              [0, 'Paz'],
            ].map(([day, label]) => (
              <button
                type="button"
                key={day}
                aria-pressed={days.includes(Number(day))}
                onClick={() =>
                  setDays(
                    days.includes(Number(day))
                      ? days.filter((value) => value !== day)
                      : [...days, Number(day)],
                  )
                }
              >
                {label}
              </button>
            ))}
          </fieldset>
        )}
        {kind === 'monthly' && (
          <label className="field-label">
            Ayın günü
            <input
              type="number"
              min={1}
              max={31}
              step={1}
              required
              value={Number.isNaN(dayOfMonth) ? '' : dayOfMonth}
              onChange={(event) => setDayOfMonth(event.target.valueAsNumber)}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>
            Vazgeç
          </button>
          <button className="primary-button" type="submit" disabled={saving || processing}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </form>
    </section>
  )
}
