import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { today, addDays, parseDay } from './lib/day'
import { currentOccurrence, isOccurrenceDone, type Task } from './lib/task'
import type { Store } from './lib/store'
import { TaskPhoto } from './task-photo'

function secondary(task: Task, now: Date) {
  if (!task.alarm) return task.note.trim() || 'tarihsiz'
  const day = currentOccurrence(task, today(now))
  let date =
    day === today(now)
      ? 'bugün'
      : day === addDays(today(now), 1)
        ? 'yarın'
        : day
          ? new Intl.DateTimeFormat('tr', { day: 'numeric', month: 'short' }).format(parseDay(day))
          : ''
  if (task.repeat) {
    const rule = task.repeat
    const repeat =
      rule.kind === 'daily'
        ? rule.interval === 1
          ? 'her gün'
          : `${rule.interval} günde bir`
        : rule.kind === 'weekly'
          ? rule.interval === 1
            ? 'her hafta'
            : `${rule.interval} haftada bir`
          : 'her ay'
    date = `${date} · ${repeat}`
  }
  return `⏰ ${task.alarm}${date ? ` · ${date}` : ''}`
}

function TaskRow({
  task,
  store,
  onEdit,
  disabled,
  now,
  onError,
}: {
  task: Task
  store: Store
  onEdit(id: string): void
  disabled: boolean
  now: Date
  onError(message: string): void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled })
  const done = isOccurrenceDone(task, today(now))
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`task-card ${done ? 'occurrence-done' : ''} ${isDragging ? 'dragging' : ''}`}
    >
      <button
        type="button"
        className="check-button"
        aria-label={`${task.title}: tamamlandı`}
        aria-pressed={done}
        disabled={done}
        onClick={() => {
          void store.complete(task.id).catch(() => onError('Görev tamamlanamadı. Yeniden deneyin.'))
        }}
      >
        <span className="check-circle">{done ? '✓' : ''}</span>
      </button>
      <button
        type="button"
        className="task-content"
        aria-label={`${task.title}: düzenle`}
        onClick={() => onEdit(task.id)}
      >
        <span className="task-title">{task.title}</span>
        <span className={`task-secondary ${task.alarm ? 'alarm-text' : ''}`}>
          {secondary(task, now)}
        </span>
      </button>
      <TaskPhoto store={store} task={task} />
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="drag-handle"
        {...attributes}
        {...listeners}
        aria-label={`${task.title}: sırala`}
        disabled={disabled}
      >
        <span aria-hidden="true">⠿</span>
      </button>
    </li>
  )
}

export function TasksScreen({ store, onEdit }: { store: Store; onEdit(id: string): void }) {
  const tasks = useLiveQuery(
    () => store.db.tasks.where('status').equals('open').sortBy('position'),
    [store],
  )
  const [search, setSearch] = useState('')
  const [grid, setGrid] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const refresh = () => setNow(new Date())
    document.addEventListener('visibilitychange', refresh)
    const timer = window.setInterval(refresh, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      clearInterval(timer)
    }
  }, [])
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const query = search.trim().toLocaleLowerCase('tr')
  const visible = (tasks ?? []).filter((task) =>
    `${task.title}\n${task.note}`.toLocaleLowerCase('tr').includes(query),
  )
  const reorder = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || query) return
    const oldIndex = visible.findIndex((task) => task.id === active.id)
    const newIndex = visible.findIndex((task) => task.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const ordered = arrayMove(visible, oldIndex, newIndex)
    void store
      .move(String(active.id), ordered[newIndex - 1]?.id ?? null, ordered[newIndex + 1]?.id ?? null)
      .catch(() => setError('Sıra kaydedilemedi. Yeniden deneyin.'))
  }
  return (
    <section aria-label="Görevler">
      <header className="page-header">
        <div>
          <p className="eyebrow">SENİN GÜNÜN, SENİN SIRAN</p>
          <h1>Görevler</h1>
        </div>
        <a className="icon-button" href="#/ayarlar" aria-label="Ayarlar">
          ⚙
        </a>
      </header>
      <label className="search-field">
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          placeholder="Görevlerde ara"
          aria-label="Görevlerde ara"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="list-toolbar">
        <p>
          {tasks?.length ?? 0} açık görev{query ? ` · ${visible.length} sonuç` : ''}
        </p>
        <div className="view-toggle" aria-label="Görünüm">
          <button type="button" aria-pressed={!grid} onClick={() => setGrid(false)}>
            Liste
          </button>
          <button type="button" aria-pressed={grid} onClick={() => setGrid(true)}>
            Izgara
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!tasks ? (
        <p className="empty-state" role="status">
          Görevler açılıyor…
        </p>
      ) : !visible.length ? (
        <div className="empty-state">
          <span aria-hidden="true" className="empty-symbol">
            ✓
          </span>
          <h2>{query ? 'Sonuç bulunamadı' : 'Biraz yer açıldı.'}</h2>
          <p>{query ? 'Başka bir sözcükle aramayı dene.' : 'Aklındakini bir göreve dönüştür.'}</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={reorder}
          accessibility={{
            screenReaderInstructions: {
              draggable:
                'Görevi taşımak için boşluk tuşuna basın. Ok tuşlarıyla konum seçin. Bırakmak için boşluk, vazgeçmek için Escape tuşuna basın.',
            },
            announcements: {
              onDragStart: () => 'Görev taşınmaya hazır.',
              onDragOver: ({ over }) =>
                over ? 'Yeni görev konumu seçildi.' : 'Görev listesinin dışındasınız.',
              onDragEnd: () => 'Görev bırakıldı.',
              onDragCancel: () => 'Taşıma iptal edildi.',
            },
          }}
        >
          <SortableContext items={visible.map((task) => task.id)} strategy={rectSortingStrategy}>
            <ul className={`task-list ${grid ? 'task-grid' : ''}`} aria-label="Açık görevler">
              {visible.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  store={store}
                  onEdit={onEdit}
                  disabled={Boolean(query)}
                  now={now}
                  onError={setError}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      <a href="#/yeni" className="fab" aria-label="Görev ekle">
        +
      </a>
    </section>
  )
}
