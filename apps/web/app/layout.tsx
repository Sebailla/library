import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Alejandría',
  description: 'Local-first personal library — Next.js 16 shell (PR-3A scaffold).',
}

/**
 * Root layout for `@alejandria/web`.
 *
 * Intentionally minimal: just wraps children in `<html><body>` so
 * the catalog + NAS browse routes can mount during PR-3A. Header /
 * nav / providers land in later PRs once the read paths stabilize.
 */
export default function RootLayout({
  children,
}: {
  children: ReactNode
}): ReactNode {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}