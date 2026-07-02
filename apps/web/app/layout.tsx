import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import './globals.css'

export const metadata: Metadata = {
  title: 'Alejandría',
  description: 'Local-first personal library — Next.js 16 shell (PR-3A scaffold).',
}

/**
 * Inline boot script — runs before React hydrates. Reads the persisted
 * theme (or OS preference) and stamps it on `<html data-theme>` so the
 * first paint matches the user's choice. Mirrors the logic in
 * `lib/hooks/useTheme.ts` so the hook's resolveInitial() agrees.
 *
 * Kept as a literal string instead of a JSX expression so the bundler
 * ships it as-is, without a React wrapper that would defer execution
 * past first paint (the FOUC we're trying to avoid).
 */
const themeBootScript = `(function(){try{var s=localStorage.getItem('alejandria.theme');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var t=s==='light'||s==='dark'?s:(d?'dark':'light');document.documentElement.setAttribute('data-theme',t);if(s==null){localStorage.setItem('alejandria.theme',t);}}catch(_){document.documentElement.setAttribute('data-theme','light');}})();`

/**
 * Root layout for `@alejandria/web`.
 *
 * PR-A adds the design-token stylesheet import and the synchronous
 * theme-boot script. The inline script is the standard Next.js pattern
 * for preventing a flash of wrong theme (FOUC) on first paint — it
 * runs before any React code, sets `data-theme` on `<html>`, and
 * persists the resolved theme back to localStorage when none was set.
 */
export default function RootLayout({
  children,
}: {
  children: ReactNode
}): ReactNode {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}