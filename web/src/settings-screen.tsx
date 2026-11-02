import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { exportBackup, importBackup } from './lib/backup'
import { today } from './lib/day'
import type { Store } from './lib/store'
import type { Task } from './lib/task'
import { useNow } from './lib/use-now'

export function SettingsScreen({
  store,
  email,
  loadPhoto,
  onLogout,
  onBack,
}: {
  store: Store
  email: string
  loadPhoto(task: Task): Promise<Blob>
  onLogout(): void
  onBack(): void
}) {
  const count = useLiveQuery(() => store.db.outbox.count(), [store])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const pending = useRef(false)
  const now = useNow()
  const run = async (action: () => Promise<string>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      setMessage(await action())
    } catch (error) {
      setError(error instanceof Error ? error.message : 'İşlem tamamlanamadı. Yeniden deneyin.')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const download = async () => {
    const text = await exportBackup(store, loadPhoto)
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `xp-tasks-${today(now)}.json`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    return 'Yedek indirildi.'
  }
  const upload = async (file: File) => {
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('Yedek dosyası okunamadı. Yeniden seçin.'))
      reader.readAsText(file)
    })
    const result = await importBackup(store, text)
    return `${result.imported} görev içe aktarıldı.${result.skipped ? ` Kalıcı silinmiş ${result.skipped} görev geri yüklenmedi.` : ''}`
  }
  const permission =
    typeof Notification === 'undefined'
      ? 'Desteklenmiyor'
      : Notification.permission === 'granted'
        ? 'İzin verildi'
        : Notification.permission === 'denied'
          ? 'Engellendi'
          : 'İzin verilmedi'
  return (
    <section>
      <header className="detail-header">
        <button type="button" className="icon-button" aria-label="Geri" onClick={onBack}>
          ←
        </button>
        <h1>Ayarlar</h1>
      </header>
      <section className="settings-card" aria-labelledby="account-title">
        <h2 id="account-title">Hesap</h2>
        <p className="account-email">{email || 'Hesabın'}</p>
        <p className="field-hint">
          {count === undefined
            ? 'Eşitleme durumu okunuyor…'
            : count
              ? `${count} değişiklik eşitlenmeyi bekliyor.`
              : 'Bekleyen değişiklik yok.'}
        </p>
        <button type="button" className="secondary-button" disabled={busy} onClick={onLogout}>
          Çıkış yap
        </button>
      </section>
      <section className="settings-card" aria-labelledby="backup-title">
        <h2 id="backup-title">Yedekleme</h2>
        <p>
          Görevlerini ve fotoğraflarını bir JSON dosyası olarak sakla. Sunucudaki fotoğrafları
          indirmek için bağlantı gerekir.
        </p>
        <button
          type="button"
          className="primary-button"
          disabled={busy}
          onClick={() => {
            void run(download)
          }}
        >
          JSON yedeği indir
        </button>
        <label className="backup-upload">
          JSON yedeği seç
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file) void run(() => upload(file))
            }}
          />
        </label>
        <p className="field-hint">
          İçe aktarma aynı kimlikli görevleri yedekteki haliyle günceller. Diğer görevlerin korunur.
          Kalıcı silinen görevler geri yüklenmez.
        </p>
        {busy && <p role="status">İşlem sürüyor…</p>}
        {message && (
          <p role="status" className="done-text">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>
      <section className="settings-card" aria-labelledby="alarm-title">
        <h2 id="alarm-title">Alarm izinleri</h2>
        <p>
          Tarayıcı bildirim izni: <strong>{permission}</strong>
        </p>
        <p className="field-hint">
          Bu tarayıcıda uygulama kapalıyken alarm çalmaz. Android alarm izinleri uygulamanın Android
          sürümünde yönetilecek.
        </p>
      </section>
    </section>
  )
}
