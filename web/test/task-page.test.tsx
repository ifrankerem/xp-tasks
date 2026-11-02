// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store } from '../src/lib/store'
import { TaskPage } from '../src/task-page'

let store: Store
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 3, 12))
  store = new Store(`detail-${crypto.randomUUID()}`)
})
afterEach(async () => {
  await store.db.delete()
  vi.useRealTimers()
})

describe('task detail', () => {
  it('reads current fields from Dexie and handles a record removed elsewhere', async () => {
    const task = await store.create({ title: 'İlk ad', note: 'Eski not' })
    render(<TaskPage store={store} taskId={task.id} onBack={vi.fn()} onEdit={vi.fn()} />)
    await screen.findByRole('heading', { name: 'İlk ad' })
    await act(async () => {
      await store.db.tasks.update(task.id, { title: 'Yeni ad', note: 'Yeni not' })
    })
    await screen.findByRole('heading', { name: 'Yeni ad' })
    expect(screen.getByText('Yeni not')).toBeInTheDocument()
    await act(async () => {
      await store.db.tasks.delete(task.id)
    })
    await screen.findByRole('heading', { name: 'Görev bulunamadı' })
  })

  it.each([
    ['Tamamlandı', 'done'],
    ['Sil', 'deleted'],
  ] as const)('%s archives a one-off task locally', async (button, archivedAs) => {
    const task = await store.create({ title: 'Tek görev' })
    const back = vi.fn()
    render(<TaskPage store={store} taskId={task.id} onBack={back} onEdit={vi.fn()} />)
    await userEvent.setup().click(await screen.findByRole('button', { name: button }))
    await waitFor(() => expect(back).toHaveBeenCalledOnce())
    expect(await store.db.tasks.get(task.id)).toMatchObject({ status: 'archived', archivedAs })
  })

  it('completes the selected repeat occurrence and leaves the task open', async () => {
    const task = await store.create({
      title: 'İki günde bir',
      date: '2026-11-02',
      repeat: { kind: 'daily', interval: 2 },
    })
    const back = vi.fn()
    render(
      <TaskPage
        store={store}
        taskId={task.id}
        occurrence="2026-11-14"
        onBack={back}
        onEdit={vi.fn()}
      />,
    )
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Tamamlandı' }))
    await waitFor(() => expect(back).toHaveBeenCalledOnce())
    expect(await store.db.tasks.get(task.id)).toMatchObject({
      status: 'open',
      doneOn: '2026-11-14',
    })
  })

  it('does not complete a non-occurrence supplied in the URL', async () => {
    const task = await store.create({
      title: 'İki günde bir',
      date: '2026-11-02',
      repeat: { kind: 'daily', interval: 2 },
    })
    const back = vi.fn()
    render(
      <TaskPage
        store={store}
        taskId={task.id}
        occurrence="2026-11-15"
        onBack={back}
        onEdit={vi.fn()}
      />,
    )
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Tamamlandı' }))
    await waitFor(() => expect(back).toHaveBeenCalledOnce())
    expect((await store.db.tasks.get(task.id))?.doneOn).toBe('2026-11-04')
  })

  it('keeps write failures visible and allows retry', async () => {
    const task = await store.create({ title: 'Silinecek' })
    vi.spyOn(store, 'remove').mockRejectedValueOnce(new Error('offline storage error'))
    const back = vi.fn()
    render(<TaskPage store={store} taskId={task.id} onBack={back} onEdit={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Sil' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('kaydedilemedi')
    expect(back).not.toHaveBeenCalled()
    expect((await store.db.tasks.get(task.id))?.status).toBe('open')
    await user.click(screen.getByRole('button', { name: 'Sil' }))
    await waitFor(() => expect(back).toHaveBeenCalledOnce())
  })
})
