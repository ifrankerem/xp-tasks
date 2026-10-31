import type { Metadata, Viewport } from 'next'
import { AuthProvider } from '@/lib/auth-context'
import { ThemeProvider } from '@/components/theme-provider'
import { XpIconDefs } from '@/components/xp-icons'
import { THEME_VALUES } from '@/lib/themes'
import './globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0a2a8a' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
}


export const metadata: Metadata = {
  title: 'Task Manager',
  description: 'A Windows XP-inspired task manager PWA',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Task Manager',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* PWA Meta Tags */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Task Manager" />
        
        {/* iOS Splash Screens (optional but nice) */}
        <link rel="apple-touch-icon" href="/apple-icon.png" />
        
        {/* Service Worker Registration */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // The native app bundles its assets; a caching service worker
              // would only serve stale builds after an APK update.
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  var cap = window.Capacitor;
                  if (cap && cap.isNativePlatform && cap.isNativePlatform()) return;
                  navigator.serviceWorker.register('/sw.js')
                    .then(function(registration) {
                      console.log('SW registered:', registration.scope);
                    })
                    .catch(function(error) {
                      console.log('SW registration failed:', error);
                    });
                });
              }
            `,
          }}
        />
      </head>
      <body className="xp-app">
        <XpIconDefs />
        <ThemeProvider
          attribute="data-theme"
          themes={Object.keys(THEME_VALUES)}
          value={THEME_VALUES}
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
