import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { liveQuery } from 'dexie'
import type { Store } from './store'
import type { Task } from './task'
import { validDay } from './calendar'

export interface AlarmPermissions {
  notifications: boolean
  exact: boolean
  fullScreen: boolean
  battery: boolean
  alarmVolume: number
  dndAllowsAlarms: boolean
}
export interface NativeAlarms {
  getActions(): Promise<{ actions: { id: string; taskId: string; occurrence: string; at: number }[] }>
  acknowledge(options: { ids: string[] }): Promise<void>
  replaceTasks(options: { tasks: Task[] }): Promise<void>
  permissions(): Promise<AlarmPermissions>
  requestNotifications(): Promise<AlarmPermissions>
  openSettings(options: { kind: 'notifications' | 'exact' | 'fullScreen' | 'battery' | 'sound' }): Promise<void>
  addListener(event: 'actionsChanged', callback: () => void): Promise<PluginListenerHandle>
}
export const nativeAlarms = Capacitor.getPlatform() === 'android' ? registerPlugin<NativeAlarms>('XpAlarms') : null

/** Drain before scheduling, and acknowledge only after the local transaction commits. */
export function startNativeAlarms(store: Store, native: NativeAlarms, onError: (message: string) => void) {
  let stopped = false
  let running = false
  let again = false
  const run = async () => {
    if (stopped) return
    if (running) { again = true; return }
    running = true
    try {
      do {
        again = false
        const { actions } = await native.getActions()
        for (const action of actions) {
          if (stopped) return
          if (!validDay(action.occurrence) || !Number.isFinite(action.at) || action.at <= 0) throw new Error('invalid action')
          await store.completeFromAlarm(action.taskId, new Date(action.at), action.occurrence)
          if (stopped) return
          await native.acknowledge({ ids: [action.id] })
        }
        const tasks = await store.db.tasks.toArray()
        if (stopped) return
        await native.replaceTasks({ tasks })
        if (!stopped) onError('')
      } while (again && !stopped)
    } catch {
      if (!stopped) onError('Alarmlar güncellenemedi. Alarm izinlerini kontrol edip yeniden dene.')
    } finally { running = false }
  }
  const resume = () => { void run() }
  const subscription = liveQuery(() => store.db.tasks.toArray()).subscribe({ next: resume, error: () => onError('Alarm görevleri okunamadı.') })
  const listener = native.addListener('actionsChanged', resume).catch(() => { if (!stopped) onError('Alarm eylemleri dinlenemiyor.') })
  document.addEventListener('visibilitychange', resume)
  return () => {
    stopped = true
    subscription.unsubscribe()
    document.removeEventListener('visibilitychange', resume)
    void listener.then(handle => handle?.remove())
  }
}
