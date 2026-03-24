import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'StormVault - Roofing Intelligence Platform',
  description: 'Generate more roofing leads with integrated storm data, property insights, and lead management.',
  keywords: ['roofing', 'lead generation', 'storm tracking', 'roofing software', 'hail tracking'],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
