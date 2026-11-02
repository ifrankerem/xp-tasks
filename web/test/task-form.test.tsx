// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Store } from '../src/lib/store'
import { TaskForm } from '../src/task-form'

let store: Store
beforeEach(() => {
  store = new Store(`form-${crypto.randomUUID()}`)
})
afterEach(async () => {
  await store.db.delete()
})

describe('task form', () => {
  it('creates a task locally and cancels without writes', async () => {
    const user = userEvent.setup()
    const saved = vi.fn(),
      cancel = vi.fn()
    const view = render(<TaskForm store={store} onSaved={saved} onCancel={cancel} />)
    await user.type(screen.getByLabelText('Görev adı'), '  Market  ')
    await user.type(screen.getByLabelText(/Not/), 'Süt al')
    await user.click(screen.getByRole('button', { name: 'Vazgeç' }))
    expect(cancel).toHaveBeenCalledOnce()
    expect(await store.db.outbox.count()).toBe(0)
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(saved).toHaveBeenCalledOnce())
    expect((await store.db.tasks.toArray())[0]).toMatchObject({
      title: 'Market',
      note: 'Süt al',
      status: 'open',
    })
    view.unmount()
  })

  it('queues only an edited field and preserves a newer remote field', async () => {
    const task = await store.create({ title: 'Market', note: 'ilk not' })
    await store.db.outbox.clear()
    const saved = vi.fn()
    render(<TaskForm store={store} taskId={task.id} onSaved={saved} onCancel={vi.fn()} />)
    const user = userEvent.setup()
    await screen.findByDisplayValue('Market')
    await store.db.tasks.update(task.id, { note: 'başka cihazın notu' })
    await user.clear(screen.getByLabelText('Görev adı'))
    await user.type(screen.getByLabelText('Görev adı'), 'Alışveriş')
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(saved).toHaveBeenCalledOnce())
    expect((await store.db.outbox.toArray()).map((entry) => entry.body)).toEqual([
      { title: 'Alışveriş' },
    ])
    expect((await store.db.tasks.get(task.id))?.note).toBe('başka cihazın notu')
  })

  it('preserves an unchanged photo and removes it explicitly', async () => {
    const task = await store.create({ title: 'Fotoğraflı' })
    await store.db.tasks.update(task.id, { photo: 'existing.jpg' })
    await store.db.outbox.clear()
    const saved = vi.fn()
    render(<TaskForm store={store} taskId={task.id} onSaved={saved} onCancel={vi.fn()} />)
    const user = userEvent.setup()
    await screen.findByDisplayValue('Fotoğraflı')
    await user.type(screen.getByLabelText('Görev adı'), ' görev')
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(saved).toHaveBeenCalledOnce())
    expect((await store.db.outbox.toArray())[0]).not.toHaveProperty('photo')
    await store.db.outbox.clear()
    await user.click(screen.getByRole('button', { name: 'Fotoğrafı kaldır' }))
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(2))
    expect((await store.db.outbox.toArray())[0]?.photo).toBeNull()
  })

  it('rejects empty weekly days, retains form values on write failure, and retries', async () => {
    const user = userEvent.setup(),
      saved = vi.fn()
    render(<TaskForm store={store} onSaved={saved} onCancel={vi.fn()} />)
    await user.type(screen.getByLabelText('Görev adı'), 'Tekrarlayan')
    await user.selectOptions(screen.getByLabelText('Tekrar'), 'weekly')
    const selected = screen.getAllByRole('button', { pressed: true })
    for (const button of selected) await user.click(button)
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('En az bir')
    await user.click(screen.getByRole('button', { name: 'Pzt' }))
    vi.spyOn(store, 'create').mockRejectedValueOnce(new Error('Depolama dolu'))
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Depolama dolu')
    expect(screen.getByLabelText('Görev adı')).toHaveValue('Tekrarlayan')
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(saved).toHaveBeenCalledOnce())
    expect((await store.db.tasks.toArray())[0]?.repeat).toEqual({
      kind: 'weekly',
      days: [1],
      interval: 1,
    })
  })
})
