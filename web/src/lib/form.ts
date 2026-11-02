import { addDays, dayKey, parseDay, today } from './day'
import type { NewTask } from './store'

export function prepareTask(input: NewTask, now: Date): NewTask {
  const title = input.title.trim()
  if (!title) throw new Error('Bir görev adı yazın.')
  if (
    input.date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || dayKey(parseDay(input.date)) !== input.date)
  ) {
    throw new Error('Geçerli bir tarih seçin.')
  }
  if (input.alarm && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.alarm))
    throw new Error('Geçerli bir alarm saati seçin.')
  const rule = input.repeat
  if (rule) {
    if (rule.kind === 'monthly') {
      if (!Number.isInteger(rule.dayOfMonth) || rule.dayOfMonth < 1 || rule.dayOfMonth > 31)
        throw new Error('Ayın gününü 1–31 arasında seçin.')
    } else {
      if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 52)
        throw new Error('Tekrar aralığını 1–52 arasında seçin.')
      if (
        rule.kind === 'weekly' &&
        (!rule.days.length || rule.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6))
      ) {
        throw new Error('En az bir haftanın günü seçin.')
      }
    }
  }
  let date = input.date
  if (input.alarm && !date && !rule) {
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    date = input.alarm > time ? today(now) : addDays(today(now), 1)
  }
  return { ...input, title, ...(date !== undefined ? { date } : {}) }
}
