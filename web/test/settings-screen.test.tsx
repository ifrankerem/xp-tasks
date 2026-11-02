// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Store } from '../src/lib/store'
import { exportBackup } from '../src/lib/backup'
import { SettingsScreen } from '../src/settings-screen'
let store: Store
beforeEach(() => {
  store = new Store(`settings-${crypto.randomUUID()}`)
})
afterEach(async () => {
  await store.db.delete()
})
const props = () => ({
  store,
  email: 'owner@example.com',
  loadPhoto: vi.fn(),
  onLogout: vi.fn(),
  onBack: vi.fn(),
})

it('shows the account, pending writes and honest alarm support; logout preserves local data', async () => {
  await store.create({ title: 'Bekleyen görev' })
  const options = props()
  render(<SettingsScreen {...options} />)
  expect(screen.getByText('owner@example.com')).toBeInTheDocument()
  await screen.findByText('1 değişiklik eşitlenmeyi bekliyor.')
  expect(screen.getByText(/Bu tarayıcıda uygulama kapalıyken alarm çalmaz/)).toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole('button', { name: 'Çıkış yap' }))
  expect(options.onLogout).toHaveBeenCalledOnce()
  expect(await store.db.tasks.count()).toBe(1)
  expect(await store.db.outbox.count()).toBe(1)
})

it('imports a file twice without duplicates and reports malformed files without changing data', async () => {
  await store.create({ title: 'Yedeklenecek' })
  const text = await exportBackup(store, vi.fn())
  render(<SettingsScreen {...props()} />)
  const input = screen.getByLabelText('JSON yedeği seç')
  for (let i = 0; i < 2; i++) {
    fireEvent.change(input, {
      target: { files: [new File([text], 'backup.json', { type: 'application/json' })] },
    })
    await screen.findByText('1 görev içe aktarıldı.')
    await waitFor(() => expect(input).not.toBeDisabled())
  }
  expect(await store.db.tasks.count()).toBe(1)
  fireEvent.change(input, {
    target: { files: [new File(['{}'], 'bad.json', { type: 'application/json' })] },
  })
  expect(await screen.findByRole('alert')).toHaveTextContent('Geçerli bir xp-tasks')
  expect(await store.db.tasks.count()).toBe(1)
})

it('downloads JSON and shows photo-download failures instead of claiming a successful backup', async () => {
  const task = await store.create({ title: 'Fotoğraflı' })
  const create = vi.fn(() => 'blob:backup')
  const revoke = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const options = props()
  options.loadPhoto.mockRejectedValue(new Error('Fotoğraf indirilemedi.'))
  render(<SettingsScreen {...options} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'JSON yedeği indir' }))
  await screen.findByText('Yedek indirildi.')
  expect(create).toHaveBeenCalledOnce()
  await store.db.tasks.update(task.id, { photo: 'remote.jpg' })
  await user.click(screen.getByRole('button', { name: 'JSON yedeği indir' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Fotoğraf indirilemedi')
  expect(create).toHaveBeenCalledOnce()
})
