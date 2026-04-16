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
  // Script to prevent theme flash on load - apply stored theme class immediately
  const themeScript = `
    (function() {
      try {
        const stored = localStorage.getItem('preferences-storage');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.state && parsed.state.appTheme) {
            document.documentElement.classList.add(parsed.state.appTheme);
          } else {
            document.documentElement.classList.add('dark');
          }
        } else {
          document.documentElement.classList.add('dark');
        }
      } catch (e) {
        document.documentElement.classList.add('dark');
      }
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