// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { Store } from '../src/lib/store'

const native = vi.hoisted(() => ({
  permissions: vi.fn(),
  requestNotifications: vi.fn(),
  openSettings: vi.fn(async () => {}),
}))
vi.mock('../src/lib/native-alarms', () => ({ nativeAlarms: native }))

const { SettingsScreen } = await import('../src/settings-screen')
const store = new Store(`settings-native-${crypto.randomUUID()}`)
afterEach(() => vi.clearAllMocks())

const all = { notifications: true, exact: true, fullScreen: true, battery: true, alarmVolume: 5, dndAllowsAlarms: true }
const renderSettings = () =>
  render(<SettingsScreen store={store} email="owner@example.com" loadPhoto={vi.fn()} onLogout={vi.fn()} onBack={vi.fn()} />)

it('shows each Android alarm requirement and opens the setting that fixes a missing one', async () => {
  native.permissions.mockResolvedValue({ ...all, fullScreen: false, alarmVolume: 0 })
  renderSettings()
  expect(await screen.findByText('Kilit ekranında tam ekran')).toBeInTheDocument()
  expect(screen.getByText(/Ekran kapalıyken yalnızca bildirim görünür/)).toBeInTheDocument()
  expect(screen.getByText(/Alarm ses seviyesi sıfır/)).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Düzelt' })).toHaveLength(2)
  await userEvent.setup().click(screen.getAllByRole('button', { name: 'Düzelt' })[0]!)
  expect(native.openSettings).toHaveBeenCalledWith({ kind: 'fullScreen' })
})

it('asks for the notification permission before sending the user to settings', async () => {
  native.permissions.mockResolvedValue({ ...all, notifications: false })
  native.requestNotifications.mockResolvedValue(all)
  renderSettings()
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Düzelt' }))
  expect(native.requestNotifications).toHaveBeenCalled()
  expect(native.openSettings).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Düzelt' })).toBeNull())
})
