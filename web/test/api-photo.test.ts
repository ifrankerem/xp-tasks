import { expect, it, vi } from 'vitest'
import PocketBase from 'pocketbase'
import { createPhotoUrl, downloadPhoto } from '../src/lib/api'

it('uses protected file tokens, reuses them briefly and requests the configured thumbnail', async () => {
  const pb = new PocketBase('https://example.test')
  const token = vi.spyOn(pb.files, 'getToken').mockResolvedValue('file-token')
  const url = createPhotoUrl(pb)
  const task = { id: 'task12345678', photo: 'picture.jpg' }
  const [thumb, full] = await Promise.all([url(task, false), url(task, true)])
  expect(token).toHaveBeenCalledOnce()
  expect(thumb).toBe(
    'https://example.test/api/files/tasks/task12345678/picture.jpg?token=file-token&thumb=240x240',
  )
  expect(full).toBe(
    'https://example.test/api/files/tasks/task12345678/picture.jpg?token=file-token',
  )
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 91_000)
  await url(task, false)
  expect(token).toHaveBeenCalledTimes(2)
})

it('retries token acquisition after a network failure', async () => {
  const pb = new PocketBase('https://example.test')
  const token = vi
    .spyOn(pb.files, 'getToken')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue('reconnected')
  const url = createPhotoUrl(pb)
  const task = { id: 'task12345678', photo: 'picture.jpg' }
  await expect(url(task, false)).rejects.toThrow('offline')
  await expect(url(task, false)).resolves.toContain('token=reconnected')
  expect(token).toHaveBeenCalledTimes(2)
})

it('downloads original photo bytes and rejects failed HTTP responses', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(new Blob(['photo'], { type: 'image/jpeg' })))
    .mockResolvedValueOnce(new Response('denied', { status: 403 }))
  expect(await (await downloadPhoto('https://example.test/protected')).text()).toBe('photo')
  expect(fetch).toHaveBeenCalledWith('https://example.test/protected')
  await expect(downloadPhoto('https://example.test/protected')).rejects.toThrow(
    'Fotoğraf indirilemedi',
  )
})
