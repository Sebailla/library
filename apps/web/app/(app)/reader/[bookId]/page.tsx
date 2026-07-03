import { Suspense } from 'react'
import { cacheLife, cacheTag } from 'next/cache'

import type { Book } from '@/lib/hooks/useSampleLibrary'
import { useSampleLibrary } from '@/lib/hooks/useSampleLibrary'

import { ReaderView } from './ReaderView'

/**
 * `/reader/[bookId]` server-component shell (PR-C2,
 * REQ-MRP-001 / MRP-005 / MRP-006).
 *
 * The route is a thin Server Component: it resolves `params.bookId`,
 * looks the book up via `useSampleLibrary()` (the same sample
 * dataset the Library page consumes — see PR-C1), and hands the
 * resolved book to the Client `ReaderView` for interactive rendering.
 *
 * If the `bookId` does NOT match a known book, the route renders
 * `<div data-testid="reader-not-found">` with a CTA back to the
 * Library. The "not found" path is rendered as a Server Component
 * so the route always reaches the user — never a 500.
 *
 * The page mounts inside the `(app)` route group's AppShell, so
 * Sidebar + Topbar wrap this content; PR-C2 only owns the inner
 * 3-zone reader surface.
 *
 * `params` in Next.js 15+ / 16 is a Promise — `await` it inside the
 * inner async component (`loadReader`) to keep the static
 * `default export` synchronous (matches the Library page pattern
 * so the cacheComponents static renderer is happy).
 */

interface ReaderRouteProps {
  params: Promise<{ bookId: string }>
}

/**
 * Enumerate the known sample-library book ids so Next.js 16 can
 * prerender the dynamic `[bookId]` route at build time
 * (`generateStaticParams` is the documented hook for cacheComponents
 * dynamic routes). The real DBs grow over time, so we also opt the
 * runtime into `force-dynamic` for ids outside this list.
 */
export async function generateStaticParams(): Promise<Array<{ bookId: string }>> {
  return useSampleLibrary().map((book) => ({ bookId: book.id }))
}

/**
 * Resolve the book from the sample library. Wrapped in `'use cache'`
 * per the `nextjs-app-shell` spec — `cacheTag('book:<id>')` so future
 * PRs can `revalidateTag` when the book changes. Per-book tag keeps
 * the cache narrow (12 entries max in the sample dataset).
 */
export async function loadReader(
  bookId: string,
): Promise<Book | undefined> {
  'use cache'
  cacheLife('hours')
  cacheTag(`book:${bookId}`)

  const library = useSampleLibrary()
  return library.find((candidate) => candidate.id === bookId)
}

async function ReaderViewRoute({
  params,
}: ReaderRouteProps): Promise<React.JSX.Element> {
  const { bookId } = await params
  const book = await loadReader(bookId)

  if (!book) {
    return (
      <div data-testid="reader-not-found" className="p-6">
        <h1 className="mb-2 text-xl font-semibold">Book not found</h1>
        <p className="mb-4 text-sm text-[var(--color-text-muted)]">
          No book with id <code>{bookId}</code> was found in the sample library.
        </p>
        <a
          href="/"
          className="inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          Back to library
        </a>
      </div>
    )
  }

  return <ReaderView book={book} />
}

export default function ReaderPage({
  params,
}: ReaderRouteProps): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-[var(--color-text-muted)]">
          Loading reader…
        </div>
      }
    >
      <ReaderViewRoute params={params} />
    </Suspense>
  )
}
