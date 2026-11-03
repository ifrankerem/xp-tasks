import { Capacitor } from '@capacitor/core'
import { createRoot } from 'react-dom/client'
import PocketBase from 'pocketbase'
import { App } from './app'
import { Store } from './lib/store'
import '@fontsource/inter/latin-ext-400.css'
import '@fontsource/inter/latin-ext-600.css'
import '@fontsource/inter/latin-ext-700.css'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import './index.css'

// The Android WebView's origin is https://localhost, so the app names the server.
const server = Capacitor.isNativePlatform() ? 'https://task.irfankerem.com' : location.origin

// Installable web app (PWA). The Android app ships its files itself.
if (import.meta.env.PROD && !Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js')
}

createRoot(document.getElementById('root')!).render(
  <App store={new Store()} pb={new PocketBase(server)} />,
)
