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

  it('browser Back restores the task list after opening the edit route', async () => {
    signIn()
    const task = await store.create({ title: 'Takip et' })
    render(<App store={store} pb={pb} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Takip et: düzenle' }))
    expect(location.hash).toBe(`#/gorev/${task.id}`)
    await screen.findByDisplayValue('Takip et')
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
