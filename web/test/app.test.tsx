// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PocketBase, { BaseAuthStore } from 'pocketbase'
import { Store } from '../src/lib/store'
import type { SyncResult } from '../src/lib/sync'
import { App } from '../src/app'

const sync = vi.hoisted(() => ({
  stop: vi.fn(),
  result: undefined as undefined | ((result: SyncResult) => void),
  start: vi.fn(),
}))
vi.mock('../src/lib/sync', () => ({
  Sync: class {
    lastError = null
  },
  startSync: (_sync: unknown, _store: unknown, callback: (result: SyncResult) => void) => {
    sync.result = callback
    sync.start()
    return sync.stop
  },
}))

let store: Store, pb: PocketBase
beforeEach(() => {
  history.replaceState(null, '', '#/')
  store = new Store(`app-${crypto.randomUUID()}`)
  pb = new PocketBase('http://localhost', new BaseAuthStore())
  sync.start.mockClear()
  sync.stop.mockClear()
  sync.result = undefined
})
afterEach(async () => {
  await store.db.delete()
  vi.useRealTimers()
})
const signIn = () =>
  pb.authStore.save('cached-token', {
    id: 'account12345678',
    collectionName: 'users',
    collectionId: 'users',
  })

describe('application shell', () => {
  it('logs in with email/password, starts sync and ensures birthday after the first successful pull only', async () => {
    vi.spyOn(pb.collection('users'), 'authWithPassword').mockImplementation(async () => {
      signIn()
      return { token: pb.authStore.token, record: pb.authStore.record! }
    })
    const ensure = vi.spyOn(store, 'ensureBirthday')
    render(<App store={store} pb={pb} />)
    expect(sync.start).not.toHaveBeenCalled()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('E-posta'), 'owner@example.com')
    await user.type(screen.getByLabelText('Şifre'), 'test-password')
    await user.click(screen.getByRole('button', { name: 'Giriş yap' }))
    await screen.findByRole('heading', { name: 'Görevler' })
    expect(sync.start).toHaveBeenCalledOnce()
    act(() => sync.result?.('offline'))
    expect(ensure).not.toHaveBeenCalled()
    act(() => {
      sync.result?.('ok')
      sync.result?.('ok')
    })
    await waitFor(() => expect(ensure).toHaveBeenCalledOnce())
  })

  it('keeps cached tasks and queued edits accessible offline, handles rejected auth and stops sync on logout', async () => {
    signIn()
    await store.create({ title: 'Çevrimdışı görev' })
    render(<App store={store} pb={pb} />)
    act(() => sync.result?.('offline'))
    expect(await screen.findByText('Çevrimdışı görev')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('bu cihazda güvende')
    expect(await store.db.outbox.count()).toBe(1)
    act(() => sync.result?.('auth'))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Yeniden giriş yap' }))
    expect(screen.getByRole('button', { name: 'Giriş yap' })).toBeInTheDocument()
    expect(sync.stop).toHaveBeenCalledOnce()
    expect(await store.db.outbox.count()).toBe(1)
  })

  it('browser Back restores the task list after opening task details', async () => {
    signIn()
    const task = await store.create({ title: 'Takip et' })
    render(<App store={store} pb={pb} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Takip et: aç' }))
    expect(location.hash).toBe(`#/gorev/${task.id}`)
    await screen.findByRole('heading', { name: 'Takip et' })
    await user.click(screen.getByRole('button', { name: 'Geri' }))
    await screen.findByRole('heading', { name: 'Görevler' })
    expect((await store.db.tasks.get(task.id))?.title).toBe('Takip et')
  })

  it('canceling the add route returns through history without leaving the canceled form behind', async () => {
    signIn()
    render(<App store={store} pb={pb} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('link', { name: 'Görev ekle' }))
    await screen.findByRole('heading', { name: 'Yeni görev' })
    const length = history.length
    await user.click(screen.getByRole('button', { name: 'Vazgeç' }))
    await screen.findByRole('heading', { name: 'Görevler' })
    expect(history.length).toBe(length)
    expect(await store.db.tasks.count()).toBe(0)
  })

  it('shows the 20 December image after a successful save only', async () => {
    signIn()
    history.replaceState(null, '', '#/yeni')
    const create = vi.spyOn(store, 'create').mockRejectedValueOnce(new Error('Kaydedilemedi'))
    render(<App store={store} pb={pb} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Görev adı'), 'Kutlama')
    fireEvent.change(screen.getByLabelText('Tarih'), { target: { value: '2026-12-20' } })
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Kaydedilemedi')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByAltText('İyi ki doğdun!')).toHaveAttribute('src', '/easter-egg.png')
    expect(create).toHaveBeenCalledTimes(2)
  })
})

describe('calendar navigation', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 3, 12))
    signIn()
  })
  const calendar = '#/takvim?ay=2026-12&gun=2026-12-14'

  it('Back from a task restores the exact month and selected day', async () => {
    const task = await store.create({ title: 'Aralık görevi', date: '2026-12-14' })
    history.replaceState(null, '', calendar)
    render(<App store={store} pb={pb} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('link', { name: 'Aralık görevi: aç' }))
    expect(location.hash).toBe(`#/gorev/${task.id}?gun=2026-12-14`)
    await screen.findByRole('heading', { name: 'Aralık görevi' })
    await user.click(screen.getByRole('button', { name: 'Geri' }))
    await screen.findByRole('heading', { name: 'Aralık 2026' })
    expect(location.hash).toBe(calendar)
    expect(screen.getByRole('button', { name: /^14 Aralık 2026/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('edit cancel and save return through details to the same calendar', async () => {
    const task = await store.create({ title: 'İlk başlık', date: '2026-12-14', note: 'aynı not' })
    await store.db.outbox.clear()
    history.replaceState(null, '', calendar)
    render(<App store={store} pb={pb} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('link', { name: 'İlk başlık: aç' }))
    await user.click(await screen.findByRole('button', { name: 'Düzenle' }))
    expect(location.hash).toBe(`#/gorev/${task.id}/duzenle?gun=2026-12-14`)
    await user.click(await screen.findByRole('button', { name: 'Vazgeç' }))
    await screen.findByRole('heading', { name: 'İlk başlık' })
    expect(await store.db.outbox.count()).toBe(0)
    await user.click(screen.getByRole('button', { name: 'Düzenle' }))
    await screen.findByDisplayValue('İlk başlık')
    await user.clear(screen.getByLabelText('Görev adı'))
    await user.type(screen.getByLabelText('Görev adı'), 'Yeni başlık')
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    await screen.findByRole('heading', { name: 'Yeni başlık' })
    expect((await store.db.outbox.toArray()).map((entry) => entry.body)).toEqual([
      { title: 'Yeni başlık' },
    ])
    await user.click(screen.getByRole('button', { name: 'Geri' }))
    await screen.findByRole('heading', { name: 'Aralık 2026' })
    expect(location.hash).toBe(calendar)
    expect(await screen.findByRole('link', { name: 'Yeni başlık: aç' })).toBeInTheDocument()
  })

  it('prefills add for the selected day and preserves the calendar after cancel and save', async () => {
    history.replaceState(null, '', calendar)
    render(<App store={store} pb={pb} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('link', { name: '+ Bu güne görev ekle' }))
    expect(screen.getByLabelText('Tarih')).toHaveValue('2026-12-14')
    await user.click(screen.getByRole('button', { name: 'Vazgeç' }))
    await screen.findByRole('heading', { name: 'Aralık 2026' })
    expect(location.hash).toBe(calendar)
    await user.click(screen.getByRole('link', { name: '+ Bu güne görev ekle' }))
    await user.type(screen.getByLabelText('Görev adı'), 'O güne eklendi')
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    await screen.findByRole('link', { name: 'O güne eklendi: aç' })
    expect(location.hash).toBe(calendar)
    expect((await store.db.tasks.toArray())[0]?.date).toBe('2026-12-14')
  })

  it('month arrows keep the selected day and tapping a day changes it', async () => {
    history.replaceState(null, '', '#/takvim?ay=2026-11&gun=2026-11-14')
    render(<App store={store} pb={pb} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Sonraki ay' }))
    expect(location.hash).toBe('#/takvim?ay=2026-12&gun=2026-11-14')
    await user.click(screen.getByRole('button', { name: /^7 Aralık 2026/ }))
    expect(location.hash).toBe('#/takvim?ay=2026-12&gun=2026-12-07')
    await user.click(screen.getByRole('button', { name: 'Bugüne dön' }))
    expect(location.hash).toBe('#/takvim?ay=2026-11&gun=2026-11-03')
  })

  it('shows only two chips plus overflow and completes the selected repeating occurrence', async () => {
    const repeat = await store.create({
      title: 'Tekrar',
      date: '2026-11-02',
      repeat: { kind: 'daily', interval: 2 },
    })
    await store.create({ title: 'İkinci', date: '2026-11-14', alarm: '18:30' })
    await store.create({ title: 'Üçüncü', date: '2026-11-14' })
    const archived = await store.create({ title: 'Arşivde', date: '2026-11-14' })
    await store.remove(archived.id)
    await store.create({ title: 'Tarihsiz görev' })
    history.replaceState(null, '', '#/takvim?ay=2026-11&gun=2026-11-14')
    render(<App store={store} pb={pb} />)
    await screen.findByRole('link', { name: 'Tekrar: aç' })
    const cell = screen.getByRole('button', { name: /^14 Kasım 2026/ })
    expect(cell.querySelectorAll('.calendar-chip')).toHaveLength(2)
    expect(cell).toHaveTextContent('+1')
    expect(cell.querySelector('.calendar-chip.alarm-text')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Arşivde: aç' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Tarihsiz görev: aç' })).not.toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Seçilen günün görevleri' })
    expect([...list.querySelectorAll('.task-title')].map((title) => title.textContent)).toEqual([
      'Üçüncü',
      'İkinci',
      'Tekrar',
    ])
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Tekrar: tamamlandı' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Tekrar: tamamlandı' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    expect(await store.db.tasks.get(repeat.id)).toMatchObject({
      status: 'open',
      doneOn: '2026-11-14',
    })
    await user.click(screen.getByRole('button', { name: /^16 Kasım 2026/ }))
    expect(screen.getByRole('button', { name: 'Tekrar: tamamlandı' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('normalizes a direct calendar URL and refreshes today on resume without moving selection', async () => {
    history.replaceState(null, '', '#/takvim')
    render(<App store={store} pb={pb} />)
    await waitFor(() => expect(location.hash).toBe('#/takvim?ay=2026-11&gun=2026-11-03'))
    expect(screen.getByRole('button', { name: /^3 Kasım 2026/ })).toHaveAttribute(
      'aria-current',
      'date',
    )
    act(() => {
      vi.setSystemTime(new Date(2026, 10, 4, 1))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.getByRole('button', { name: /^4 Kasım 2026/ })).toHaveAttribute(
      'aria-current',
      'date',
    )
    expect(screen.getByRole('button', { name: /^3 Kasım 2026/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(location.hash).toBe('#/takvim?ay=2026-11&gun=2026-11-03')
  })
})
