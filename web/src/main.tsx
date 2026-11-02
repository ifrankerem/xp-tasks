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

createRoot(document.getElementById('root')!).render(
  <App store={new Store()} pb={new PocketBase(location.origin)} />,
)
