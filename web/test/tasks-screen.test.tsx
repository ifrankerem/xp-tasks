// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Store } from '../src/lib/store'
import { Sync } from '../src/lib/sync'
import { FakeApi } from './fake-api'
import { TasksScreen } from '../src/tasks-screen'

let store: Store
beforeEach(() => {
  store = new Store(`tasks-${crypto.randomUUID()}`)
})
afterEach(async () => {
  await store.db.delete()
})

describe('tasks screen', () => {
  it('keeps manual order through list/grid and searches Turkish title and note', async () => {
    await store.create({ title: 'İLK GÖREV' })
    await store.create({ title: 'Market', note: 'IŞIK al' })
    render(<TasksScreen store={store} onEdit={vi.fn()} />)
    const list = await screen.findByRole('list', { name: 'Açık görevler' })
    const titles = () =>
      within(list)
        .getAllByRole('listitem')
        .map((row) => row.querySelector('.task-title')?.textContent)
    expect(titles()).toEqual(['Market', 'İLK GÖREV'])
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Izgara' }))
    expect(titles()).toEqual(['Market', 'İLK GÖREV'])
    await user.type(screen.getByRole('searchbox'), 'ışık')
    expect(titles()).toEqual(['Market'])
    expect(screen.getByRole('button', { name: 'Market: sırala' })).toBeDisabled()
    await user.clear(screen.getByRole('searchbox'))
    await user.type(screen.getByRole('searchbox'), 'ilk')
    expect(titles()).toEqual(['İLK GÖREV'])
    expect((await store.db.tasks.orderBy('position').toArray()).map((task) => task.title)).toEqual([
      'Market',
      'İLK GÖREV',
    ])
  })

  it('reacts to persisted completion, keeps repeating tasks and resists stale sync', async () => {
    const task = await store.create({ title: 'Tek görev' })
    await store.create({ title: 'Tekrar', repeat: { kind: 'daily', interval: 1 } })
    const api = new FakeApi(),
      sync = new Sync(store, api)
    await sync.run()
    render(<TasksScreen store={store} onEdit={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Tek görev: tamamlandı' }))
    await waitFor(() => expect(screen.queryByText('Tek görev')).not.toBeInTheDocument())
    await sync.applyRemote(task)
    expect(screen.queryByText('Tek görev')).not.toBeInTheDocument()
    expect((await store.db.tasks.get(task.id))?.status).toBe('archived')
    await user.click(screen.getByRole('button', { name: 'Tekrar: tamamlandı' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Tekrar: tamamlandı' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    expect(screen.getByText('Tekrar')).toBeInTheDocument()
  })

  it('reorders by keyboard through store.move with the new neighbors', async () => {
    const second = await store.create({ title: 'İkinci' })
    const first = await store.create({ title: 'Birinci' })
    const move = vi.spyOn(store, 'move')
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const row = this.closest('li')
      const index = row?.parentElement ? [...row.parentElement.children].indexOf(row) : 0
      const y = Math.max(0, index) * 100
      return {
        x: 0,
        y,
        top: y,
        bottom: y + 90,
        left: 0,
        right: 400,
        width: 400,
        height: 90,
        toJSON: () => ({}),
      }
    })
    render(<TasksScreen store={store} onEdit={vi.fn()} />)
    const handle = await screen.findByRole('button', { name: 'Birinci: sırala' })
    handle.focus()
    const user = userEvent.setup()
    await user.keyboard('[Space]')
    await waitFor(() => expect(handle.closest('li')).toHaveClass('dragging'))
    await user.keyboard('[ArrowDown]')
    await user.keyboard('[Space]')
    await waitFor(() => expect(move).toHaveBeenCalledWith(first.id, second.id, null))
  })
})
