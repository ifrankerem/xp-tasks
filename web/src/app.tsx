import { Component, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type PocketBase from 'pocketbase'
import { ClientResponseError } from 'pocketbase'
import { createPhotoUrl, pocketbaseApi } from './lib/api'
import type { Store } from './lib/store'
import { Sync, startSync, type SyncResult } from './lib/sync'
import { TaskForm } from './task-form'
import { TasksScreen } from './tasks-screen'
import { PhotoUrlContext } from './task-photo'

function Login({ pb }: { pb: PocketBase }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      await pb
        .collection('users')
        .authWithPassword(String(form.get('email')), String(form.get('password')))
    } catch (error) {
      setError(
        error instanceof ClientResponseError && error.status === 0
          ? 'Bağlantı kurulamadı. İnterneti kontrol edip yeniden deneyin.'
          : 'Giriş yapılamadı. E-posta ve şifrenizi kontrol edin.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="login-page">
      <div className="login-mark" aria-hidden="true">
        ✓
      </div>
      <p className="eyebrow">KENDİNE BİRAZ YER AÇ</p>
      <h1>
        Bir şey eksilince,
        <br />
        günün hafifler.
      </h1>
      <p className="login-copy">Görevlerine kaldığın yerden devam et.</p>
      <form
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <label className="field-label">
          E-posta
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label className="field-label">
          Şifre
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? 'Giriş yapılıyor…' : 'Giriş yap'}
        </button>
      </form>
      <p className="login-footnote">
        Görevlerin cihazına kaydedilir.
        <br />
        Bağlandığında kendiliğinden eşitlenir.
      </p>
    </main>
  )
}

class StorageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <main className="empty-state">
        <h1>Görevler açılamadı</h1>
        <p>Cihaz depolamasına erişilemiyor. Tarayıcı izinlerini kontrol edip yeniden deneyin.</p>
        <button className="secondary-button" onClick={() => location.reload()}>
          Yeniden dene
        </button>
      </main>
    ) : (
      this.props.children
    )
  }
}

export function App({ store, pb }: { store: Store; pb: PocketBase }) {
  const [auth, setAuth] = useState(() => ({
    id: pb.authStore.record?.id ?? '',
    token: pb.authStore.token,
  }))
  const account = auth.id
  const [hash, setHash] = useState(() => location.hash || '#/')
  const [result, setResult] = useState<SyncResult>('ok')
  const [error, setError] = useState('')
  const [birthday, setBirthday] = useState(false)
  const photoUrl = useMemo(
    () => (auth.token ? createPhotoUrl(pb) : async () => ''),
    [pb, auth.token],
  )
  useEffect(
    () => pb.authStore.onChange((token, record) => setAuth({ id: record?.id ?? '', token })),
    [pb],
  )
  useEffect(() => {
    const change = () => {
      setHash(location.hash || '#/')
      setBirthday(false)
    }
    window.addEventListener('hashchange', change)
    window.addEventListener('popstate', change)
    return () => {
      window.removeEventListener('hashchange', change)
      window.removeEventListener('popstate', change)
    }
  }, [])
  useEffect(() => {
    if (!account) return
    let active = true
    let ensured = false
    setResult('ok')
    const sync = new Sync(store, pocketbaseApi(pb))
    const stop = startSync(sync, store, (status) => {
      if (!active) return
      setResult(status)
      if (status === 'ok' && !ensured) {
        ensured = true
        void store.ensureBirthday().catch(() => {
          if (active) setError('Doğum günü görevi kaydedilemedi. Uygulamayı yeniden açın.')
        })
      }
      if (sync.lastError)
        setError('Bir değişiklik sunucuya kaydedilemedi. Görevi kontrol edip yeniden deneyin.')
    })
    return () => {
      active = false
      stop()
    }
  }, [account, pb, store])
  const navigate = (path: string) => {
    history.pushState({ xpTasks: true }, '', `#${path}`)
    setHash(`#${path}`)
  }
  const back = () => {
    if (history.state?.xpTasks) history.back()
    else navigate('/')
  }
  if (!account) return <Login pb={pb} />
  const route = hash.slice(1).split('?')[0] || '/'
  const edit = /^\/gorev\/([a-z0-9]{8,32})$/.exec(route)
  const form = route === '/yeni' || Boolean(edit)
  const names: Record<string, string> = {
    '/takvim': 'Takvim',
    '/arsiv': 'Arşiv',
    '/ayarlar': 'Ayarlar',
  }
  return (
    <StorageBoundary>
      <PhotoUrlContext value={photoUrl}>
        <div
          className="app-shell"
          onClickCapture={(event) => {
            const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#/"]')
            if (
              !anchor ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return
            event.preventDefault()
            if (anchor.hash !== hash) navigate(anchor.hash.slice(1))
          }}
        >
          <div inert={birthday}>
            {result !== 'ok' && (
              <div className={`sync-banner ${result === 'auth' ? 'error' : ''}`} role="status">
                {result === 'offline' ? (
                  'Çevrimdışısın · Değişikliklerin bu cihazda güvende.'
                ) : (
                  <>
                    Oturumunu yenilemen gerekiyor.{' '}
                    <button className="text-button" onClick={() => pb.authStore.clear()}>
                      Yeniden giriş yap
                    </button>
                  </>
                )}
              </div>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {form ? (
              <TaskForm
                store={store}
                taskId={edit?.[1]}
                onCancel={back}
                onSaved={(task) => {
                  if (task.date?.slice(5) === '12-20') setBirthday(true)
                  else back()
                }}
              />
            ) : route === '/' ? (
              <TasksScreen store={store} onEdit={(id) => navigate(`/gorev/${id}`)} />
            ) : (
              <section>
                <header className="page-header">
                  <h1>{names[route] ?? 'Sayfa bulunamadı'}</h1>
                </header>
                <div className="empty-state">
                  <p>
                    {names[route]
                      ? 'Bu ekran sonraki aşamada eklenecek.'
                      : 'Bu adres artık kullanılmıyor.'}
                  </p>
                  <a className="secondary-button" href="#/">
                    Görevlere dön
                  </a>
                </div>
              </section>
            )}
            {!form && (
              <nav className="bottom-nav" aria-label="Ana gezinme">
                {[
                  ['/', 'Görevler', '☑'],
                  ['/takvim', 'Takvim', '▦'],
                  ['/arsiv', 'Arşiv', '▣'],
                ].map(([path, label, icon]) => (
                  <a
                    key={path}
                    href={`#${path}`}
                    aria-current={route === path ? 'page' : undefined}
                  >
                    <span aria-hidden="true">{icon}</span>
                    {label}
                  </a>
                ))}
              </nav>
            )}
          </div>
          {birthday && (
            <div className="celebration-backdrop">
              <section
                className="celebration"
                role="dialog"
                aria-modal="true"
                aria-label="Doğum günü"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setBirthday(false)
                    back()
                  }
                  if (event.key === 'Tab') event.preventDefault()
                }}
              >
                <img src="/easter-egg.png" alt="İyi ki doğdun!" />
                <h2>20 Aralık kutlu olsun! 🎂</h2>
                <p>Görevin kaydedildi.</p>
                <button
                  autoFocus
                  className="primary-button"
                  onClick={() => {
                    setBirthday(false)
                    back()
                  }}
                >
                  Devam et
                </button>
              </section>
            </div>
          )}
        </div>
      </PhotoUrlContext>
    </StorageBoundary>
  )
}
