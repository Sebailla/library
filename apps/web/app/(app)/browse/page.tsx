import { Suspense } from 'react'

import sampleNasData from '@/data/sample-nas.json'

import { BrowseView } from './BrowseView'
import type { NasBook } from './types'

/**
 * `/browse` page — Server Component shell (PR-D1,
 * REQ-MBP-001 / REQ-MBP-003 / REQ-MBP-004 / REQ-MBP-005).
 *
 * The route imports the 20-book NAS mock directly and hands the
 * list to the Client `BrowseView`. The mock is hardcoded for v1 so
 * the page renders without a NAS connection; a later change wires
 * the real `openNasClient().listBooks()` and feeds the same shape.
 *
 * `searchParams` is a Promise in Next.js 15+ / 16 — we `await` it
 * inside the inner async component (`BrowseRoute`) so the static
 * default export stays synchronous (matches the Library + Reader
 * pattern that Next.js 16 `cacheComponents` is happy with).
 *
 * The inner view is wrapped in `<Suspense>` so React can hydrate
 * the chips and the empty-state CTA even if the data resolution
 * takes a tick (parity with Library).
 */

interface BrowseRouteProps {
  searchParams?: Promise<{
    q?: string
    category?: string
    format?: string
    lang?: string
  }>
}

async function BrowseRoute({
  searchParams,
}: BrowseRouteProps): Promise<React.JSX.Element> {
  const params = searchParams ? await searchParams : undefined
  const books = sampleNasData as readonly NasBook[]

  return (
    <BrowseView
      initialNasBooks={books}
      initialQuery={params?.q ?? ''}
    />
  )
}

export default function BrowsePage({
  searchParams,
}: BrowseRouteProps): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="py-16 text-center text-sm text-[var(--color-text-muted)]">
          Cargando…
        </div>
      }
    >
      <BrowseRoute searchParams={searchParams} />
    </Suspense>
  )
}