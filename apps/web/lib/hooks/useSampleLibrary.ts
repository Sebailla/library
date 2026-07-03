import sampleLibraryData from '@/data/sample-library.json'

/**
 * Canonical `Book` shape for the sample library dataset
 * (PR-C1, REQ-MLP-002). The optional `lang` discriminator lets
 * the UI render language-aware filters and the test suite
 * assert Spanish/English author mix without string-matching
 * author names.
 */
export interface Book {
  id: string
  title: string
  author: string
  year: number
  format: 'pdf' | 'epub'
  coverUrl: string
  progress?: number
  lang?: 'es' | 'en'
}

/**
 * `useSampleLibrary` — single source of truth for the 12-book
 * sample dataset that powers the Library grid in development
 * and the Search/Browse fallbacks (PR-C1, REQ-MLP-002).
 *
 * The hook is intentionally a thin wrapper around a static
 * JSON import: future iterations may add state (RSC vs client,
 * virtualisation, indexed lookup) but for v1 the array is the
 * data. Treating it as a hook now lets callers swap the
 * implementation later without API churn.
 *
 * The returned array is `readonly` to prevent callers from
 * mutating the shared bundle data; downstream filtering / sorting
 * must produce a new array.
 */
export function useSampleLibrary(): readonly Book[] {
  return sampleLibraryData as readonly Book[]
}