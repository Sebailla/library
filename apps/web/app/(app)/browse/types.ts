/**
 * `NasBook` — canonical shape for the Browse mock dataset
 * (PR-D1, REQ-MBP-003). Distinct from `Book` (used by the
 * Library grid) because the Browse catalog carries an explicit
 * `category` discriminator and is expected to grow more fields
 * (sagas, tags) once the real NAS client lands.
 *
 * Fields:
 *
 *   - id, title, author, year, format, coverUrl: identical to
 *     `Book` so the `BrowseView` can map them onto `BookCard`.
 *   - category: NAS-side grouping (fiction / non-fiction /
 *     science / tech / history). The Library grid does NOT
 *     surface this field; the Browse sidebar uses it as a
 *     filter dimension.
 *   - lang: language discriminator (mirrors `Book.lang`).
 */
export interface NasBook {
  id: string
  title: string
  author: string
  year: number
  format: 'pdf' | 'epub'
  coverUrl: string
  category: 'fiction' | 'non-fiction' | 'science' | 'tech' | 'history'
  lang: 'es' | 'en'
}