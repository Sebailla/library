# nextjs-app-shell Specification

## Purpose

Provides the Next.js 16 + React 19 application shell: App Router with React Server Components for catalog, search, and details pages; Client Components for the reader and editor interactions; lazy-loaded `pdfjs-dist` and `epub.js` via `next/dynamic` so the readers never enter the catalog bundle. The shell talks to the NAS catalog via a thin `INasClient` and to the local SQLite via a `packages/infrastructure/local-store/` module.

## Requirements

### Requirement: App Router with RSC by default

The shell MUST use Next.js 16 App Router. Pages under `app/(catalog)/` and `app/(nas)/` MUST be React Server Components by default. Components that need browser APIs (event handlers, `useEffect`, `useState`) MUST be marked with `'use client'` at the top of the file.

#### Scenario: Catalog page renders on the server

- GIVEN the user navigates to `/catalog`
- WHEN the page loads
- THEN the initial HTML contains the catalog grid markup
- AND no `useEffect` runs during the SSR phase

#### Scenario: Search input is a Client Component

- GIVEN the search box lives in the catalog header
- WHEN the file is inspected
- THEN the first line is `'use client'`
- AND the input has an `onChange` handler bound to a debounced router push

### Requirement: Readers lazy-loaded via next/dynamic

The PDF reader (`pdfjs-dist` + `react-pdf-highlighter`) and the EPUB reader (`epub.js`) MUST be imported through `next/dynamic({ ssr: false })`. The catalog page bundle MUST NOT contain `pdfjs-dist` or `epub.js` until the user actually opens a book.

#### Scenario: Catalog bundle excludes the reader

- GIVEN the user is on `/catalog` and has not opened any book
- WHEN the network panel is inspected
- THEN no chunk matching `pdfjs-dist` or `epub.js` is fetched

#### Scenario: Opening a book loads the reader chunk

- GIVEN the user is on `/catalog`
- WHEN they click a book row
- THEN the route navigates to `/reader/[bookId]`
- AND the dynamic import resolves and the reader chunk is fetched

### Requirement: TypeScript types mirror MVP models

The shell MUST ship `packages/core/types/` mirroring the dataclasses from the MVP `alejandria/core/models.py`. Types include `Book`, `Author`, `Category`, `Note`, `Highlight`, `Bookmark`, `ReadingProgress`. The shell MUST NOT redefine these types ad hoc in feature folders.

#### Scenario: Importing Book from core types works

- GIVEN `packages/core/types/Book.ts` exists
- WHEN a feature file does `import type { Book } from "@alejandria/core/types"`
- THEN the type is available at compile time
- AND no feature-local copy of `Book` is needed

### Requirement: 'use cache' for catalog reads

Catalog list, category tree, and book detail pages MUST use the Next.js `'use cache'` directive with explicit `cacheLife` and `cacheTag`. Cache MUST be invalidated when the NAS reports a `book.updated` event.

#### Scenario: Catalog grid is cached

- GIVEN a catalog page renders 1,000 books
- WHEN the same user revisits the page within the `cacheLife` window
- THEN the second render is served from the cache
- AND no upstream call to `INasClient.search` is made

#### Scenario: Cache invalidates on book.updated

- GIVEN a cached catalog page is on screen
- WHEN the NAS emits `book.updated` for `book_id = "X"`
- THEN the cache entry tagged `book-X` is purged
- AND the next render fetches fresh data

### Requirement: TanStack Query for mutations and live state

Mutations (open NAS browse, trigger download, pair device, restart scan) MUST run through TanStack Query. Read paths that depend on user input (search box) MAY use TanStack Query as an alternative to RSC fetching.

#### Scenario: Download mutation invalidates the local library

- GIVEN the user clicks "Download" on a NAS book
- WHEN the mutation resolves
- THEN TanStack Query invalidates `["local-library"]`
- AND the new book appears in the local catalog grid

### Requirement: Error envelope parser shared with NAS client

The shell MUST contain a single `parseApiError(response)` helper that turns any `{error:{code,message,details}}` body into a typed `ApiError` class. The helper MUST be reused by both the legacy `ApiClient` (MVP) and the new `NasApiClient`.

#### Scenario: NAS 404 surfaces a typed ApiError

- GIVEN a `GET /api/books/unknown` returns 404 with the error envelope
- WHEN the response is parsed
- THEN `parseApiError` returns `new ApiError("BOOK_NOT_FOUND", "...", {...})`
- AND the UI shows the error message

## Cross-references

- Depends on: `nas-catalog-service` (REST API), `local-library-db` (SQLite mirror)
- Consumed by: every UI capability (`library-browse-ui`, `library-search-ui`, `book-reader`, `nas-browse-download`)
- Layered in: MVC layer 1 (View) per refactor 04