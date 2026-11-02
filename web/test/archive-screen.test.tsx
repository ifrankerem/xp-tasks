// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Store } from '../src/lib/store'
import { ArchiveScreen } from '../src/archive-screen'
let store: Store
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 3, 12))
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  store = new Store(`archive-${crypto.randomUUID()}`)
})
afterEach(async () => {
  await store.db.delete()
  vi.useRealTimers()
})

it('shows archived tasks by reason and restores them live without changing order', async () => {
  const done = await store.create({ title: 'Tamamlanan görev' })
  const deleted = await store.create({ title: 'Silinen görev' })
  await store.create({ title: 'Açık görev' })
  await store.complete(done.id)
  await store.remove(deleted.id)
  render(<ArchiveScreen store={store} />)
  await screen.findByRole('link', { name: 'Tamamlanan görev: aç' })
  expect(screen.queryByRole('link', { name: 'Açık görev: aç' })).not.toBeInTheDocument()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /^Silinenler/ }))
  expect(screen.queryByRole('link', { name: 'Tamamlanan görev: aç' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Silinen görev: geri getir' }))
  await waitFor(() =>
    expect(screen.queryByRole('link', { name: 'Silinen görev: aç' })).not.toBeInTheDocument(),
  )
  expect(await store.db.tasks.get(deleted.id)).toMatchObject({
    status: 'open',
    archivedAs: null,
    position: deleted.position,
  })
})

it('requires one confirmation, cancels safely, then purges task, photo and pending writes', async () => {
  const task = await store.create({ title: 'Fotoğraflı', photo: new Blob(['photo']) })
  await store.remove(task.id)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  render(<ArchiveScreen store={store} />)
  const button = await screen.findByRole('button', { name: 'Fotoğraflı: kalıcı sil' })
  const user = userEvent.setup()
  await user.click(button)
  expect(await store.db.tasks.get(task.id)).toBeDefined()
  expect(confirm).toHaveBeenCalledTimes(1)
  await user.click(button)
  await waitFor(() =>
    expect(screen.queryByRole('link', { name: 'Fotoğraflı: aç' })).not.toBeInTheDocument(),
  )
  expect(confirm).toHaveBeenCalledTimes(2)
  expect(await store.db.tombstones.get(task.id)).toEqual({ id: task.id })
  expect(await store.db.photos.get(task.id)).toBeUndefined()
  expect(await store.db.outbox.toArray()).toEqual([
    expect.objectContaining({ taskId: task.id, kind: 'delete' }),
  ])
})

it('shows failures and allows retry; completed repeats stay out of the archive', async () => {
  const repeat = await store.create({ title: 'Tekrar', repeat: { kind: 'daily', interval: 1 } })
  await store.complete(repeat.id)
  const task = await store.create({ title: 'Geri getirilecek' })
  await store.remove(task.id)
  vi.spyOn(store, 'restore').mockRejectedValueOnce(new Error('disk full'))
  render(<ArchiveScreen store={store} />)
  const button = await screen.findByRole('button', { name: 'Geri getirilecek: geri getir' })
  expect(screen.queryByRole('link', { name: 'Tekrar: aç' })).not.toBeInTheDocument()
  const user = userEvent.setup()
  await user.click(button)
  expect(await screen.findByRole('alert')).toHaveTextContent('kaydedilemedi')
  expect(await store.db.tasks.get(task.id)).toMatchObject({ status: 'archived' })
  await user.click(button)
  await screen.findByText('Arşivin boş.')
})
