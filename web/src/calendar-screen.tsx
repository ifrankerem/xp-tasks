import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { calendarPath, calendarState, monthDays, shiftMonth } from './lib/calendar'
import { parseDay, today } from './lib/day'
import type { Store } from './lib/store'
import { isOccurrenceDone, occursOnDay } from './lib/task'
import { useNow } from './lib/use-now'
import { TaskPhoto } from './task-photo'

const dateLabel = (day: string) =>
  new Intl.DateTimeFormat('tr', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    parseDay(day),
  )

export function CalendarScreen({
  store,
  query,
  onNavigate,
}: {
  store: Store
  query: string
  onNavigate(path: string, replace?: boolean): void
}) {
  const now = useNow()
  const { month, day } = calendarState(query, now)
  const path = calendarPath(month, day)
  useEffect(() => {
    if (`/takvim${query ? `?${query}` : ''}` !== path) onNavigate(path, true)
  }, [query, path, onNavigate])
  const tasks = useLiveQuery(
    () => store.db.tasks.where('status').equals('open').sortBy('position'),
    [store],
  )
  const [error, setError] = useState('')
  const selectedTasks = (tasks ?? []).filter((task) => occursOnDay(task, day))
  const monthLabel = new Intl.DateTimeFormat('tr', { month: 'long', year: 'numeric' }).format(
    parseDay(`${month}-01`),
  )
  return (
    <section className="calendar-page" aria-label="Takvim">
      <header className="calendar-header">
        <button
          type="button"
          className="icon-button"
          aria-label="Önceki ay"
          onClick={() => onNavigate(calendarPath(shiftMonth(month, -1), day), true)}
        >
          ‹
        </button>
        <h1>{monthLabel}</h1>
        <button
          type="button"
          className="icon-button"
          aria-label="Sonraki ay"
          onClick={() => onNavigate(calendarPath(shiftMonth(month, 1), day), true)}
        >
          ›
        </button>
      </header>
      <div className="calendar-toolbar">
        <p>Gününe bir göz at.</p>
        <button
          type="button"
          className="text-button"
          aria-label="Bugüne dön"
          onClick={() => onNavigate(calendarPath(today(now).slice(0, 7), today(now)), true)}
        >
          Bugün
        </button>
      </div>
      <div className="calendar-weekdays" aria-hidden="true">
        {['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pa'].map((name) => (
          <span key={name}>{name}</span>
        ))}
      </div>
      <div className="calendar-grid" role="group" aria-label={`${monthLabel} günleri`}>
        {monthDays(month).map((date) => {
          const entries = (tasks ?? []).filter((task) => occursOnDay(task, date))
          return (
            <button
              type="button"
              key={date}
              className={`calendar-day ${date.startsWith(month) ? '' : 'outside-month'}`}
              aria-label={`${dateLabel(date)} · ${entries.length} görev`}
              aria-pressed={date === day}
              aria-current={date === today(now) ? 'date' : undefined}
              onClick={() => onNavigate(calendarPath(date.slice(0, 7), date), true)}
            >
              <span className="day-number">{parseDay(date).getDate()}</span>
              {entries.slice(0, 2).map((task) => (
                <span
                  key={task.id}
                  className={`calendar-chip ${task.alarm ? 'alarm-text' : ''}`}
                  title={task.title}
                >
                  {task.title}
                </span>
              ))}
              {entries.length > 2 && <span className="calendar-more">+{entries.length - 2}</span>}
            </button>
          )
        })}
      </div>
      <div className="selected-day-header">
        <h2>
          {new Intl.DateTimeFormat('tr', { day: 'numeric', month: 'long', weekday: 'long' }).format(
            parseDay(day),
          )}
        </h2>
        <span>{selectedTasks.length} görev</span>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!tasks ? (
        <p role="status" className="field-hint">
          Görevler açılıyor…
        </p>
      ) : selectedTasks.length ? (
        <ul className="task-list" aria-label="Seçilen günün görevleri">
          {selectedTasks.map((task) => {
            const done = isOccurrenceDone(task, day)
            return (
              <li className={`task-card ${done ? 'occurrence-done' : ''}`} key={task.id}>
                <button
                  type="button"
                  className="check-button"
                  aria-label={`${task.title}: tamamlandı`}
                  aria-pressed={done}
                  disabled={done}
                  onClick={() => {
                    void store
                      .complete(task.id, new Date(), day)
                      .catch(() => setError('Görev tamamlanamadı. Yeniden deneyin.'))
                  }}
                >
                  <span className="check-circle">{done ? '✓' : ''}</span>
                </button>
                <a
                  className="task-content"
                  href={`#/gorev/${task.id}?gun=${day}`}
                  aria-label={`${task.title}: aç`}
                >
                  <span className="task-title">{task.title}</span>
                  <span className={`task-secondary ${task.alarm ? 'alarm-text' : ''}`}>
                    {task.alarm ? `⏰ ${task.alarm}` : task.note.trim() || 'Not eklenmemiş'}
                  </span>
                </a>
                <TaskPhoto store={store} task={task} />
                <span className="task-chevron" aria-hidden="true">
                  ›
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="day-empty">Bu gün için görevin yok.</p>
      )}
      <a className="calendar-add" href={`#/yeni?gun=${day}`}>
        + Bu güne görev ekle
      </a>
    </section>
  )
}
