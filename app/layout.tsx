import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'OCR_Rename_Exp — Expense Scanner',
  description: 'Automated expense receipt scanning and classification for Avvale',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
