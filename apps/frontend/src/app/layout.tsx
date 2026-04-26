import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Eavesight - Roofing Intelligence Platform',
  description: 'Generate more roofing leads with integrated storm data, property insights, and lead management.',
  keywords: ['roofing', 'lead generation', 'storm tracking', 'roofing software', 'hail tracking'],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Pre-hydration theme script. Runs before React mounts so the user never
  // sees a flash of the wrong theme. Writes are idempotent (removes both
  // classes first, then adds one) so re-running it on nav can't leave both
  // classes set at once. Default to 'dark' when storage is empty or broken.
  const themeScript = `
    (function() {
      var theme = 'dark';
      try {
        var stored = localStorage.getItem('preferences-storage');
        if (stored) {
          var parsed = JSON.parse(stored);
          if (parsed && parsed.state && parsed.state.appTheme) {
            theme = parsed.state.appTheme;
          }
        }
      } catch (e) { /* fall through to default */ }
      var root = document.documentElement;
      root.classList.remove('dark', 'light');
      root.classList.add(theme);
    })();
  `;

  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
      </head>
      <body className={inter.className}>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  )
}