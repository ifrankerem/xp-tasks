// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { compressPhoto } from '../src/lib/photo'
import { PhotoUrlContext, TaskPhoto } from '../src/task-photo'
import { Store } from '../src/lib/store'

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(() => 'blob:local-photo'),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  })
})

it('scales proportionally, reduces quality, returns JPEG Blob and releases its URL', async () => {
  vi.stubGlobal(
    'Image',
    class {
      width = 2400
      height = 1200
      onload = () => {}
      set src(_value: string) {
        queueMicrotask(() => this.onload())
      }
    },
  )
  const draw = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: draw,
  } as unknown as CanvasRenderingContext2D)
  const qualities: number[] = []
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type, quality) => {
    qualities.push(Number(quality))
    callback(new Blob([new Uint8Array(qualities.length === 1 ? 800_000 : 600_000)], { type }))
  })
  try {
    const photo = await compressPhoto(new Blob(['image']))
    expect(photo.type).toBe('image/jpeg')
    expect(photo.size).toBe(600_000)
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 1200, 600)
    expect(qualities).toEqual([0.7, 0.6])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-photo')
  } finally {
    vi.unstubAllGlobals()
  }
})

it('reports image and encoder failures and releases temporary URLs', async () => {
  vi.stubGlobal(
    'Image',
    class {
      onerror = () => {}
      set src(_value: string) {
        queueMicrotask(() => this.onerror())
      }
    },
  )
  try {
    await expect(compressPhoto(new Blob(['bad']))).rejects.toThrow('Fotoğraf açılamadı')
  } finally {
    vi.unstubAllGlobals()
  }
  expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
  vi.stubGlobal(
    'Image',
    class {
      width = 100
      height = 100
      onload = () => {}
      set src(_value: string) {
        queueMicrotask(() => this.onload())
      }
    },
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(null))
  try {
    await expect(compressPhoto(new Blob(['image']))).rejects.toThrow('Fotoğraf sıkıştırılamadı')
  } finally {
    vi.unstubAllGlobals()
  }
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
})

it('shows persisted pending photos before server thumbnails and releases object URLs on unmount', async () => {
  const store = new Store(`photo-${crypto.randomUUID()}`)
  const task = await store.create({ title: 'Fotoğraf' })
  task.photo = 'server.jpg'
  await store.db.photos.put({ taskId: task.id, blob: new Blob(['offline']), seq: 1 })
  const view = render(
    <PhotoUrlContext value={async () => 'https://example.test/protected-photo'}>
      <TaskPhoto store={store} task={task} />
    </PhotoUrlContext>,
  )
  await waitFor(() =>
    expect(screen.getByAltText('Görev fotoğrafı')).toHaveAttribute('src', 'blob:local-photo'),
  )
  await act(async () => {
    await store.db.photos.delete(task.id)
  })
  await waitFor(() =>
    expect(screen.getByAltText('Görev fotoğrafı')).toHaveAttribute(
      'src',
      'https://example.test/protected-photo',
    ),
  )
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-photo')
  view.unmount()
  await store.db.delete()
})

it('removing an unavailable remote photo clears its preview too', async () => {
  const store = new Store(`photo-remove-${crypto.randomUUID()}`)
  const task = await store.create({ title: 'Fotoğraf' })
  task.photo = 'server.jpg'
  const source = vi.fn(async () => {
    throw new Error('offline')
  })
  const view = render(
    <PhotoUrlContext value={source}>
      <TaskPhoto store={store} task={task} />
    </PhotoUrlContext>,
  )
  await screen.findByRole('img', { name: 'Fotoğraf bağlantı kurulunca açılacak' })
  view.rerender(
    <PhotoUrlContext value={source}>
      <TaskPhoto store={store} task={task} replacement={null} />
    </PhotoUrlContext>,
  )
  await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument())
  view.unmount()
  await store.db.delete()
})
