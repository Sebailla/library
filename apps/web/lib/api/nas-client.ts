/**
 * HTTP client for the NAS catalog service (PR-2 / `nas-catalog-service`).
 *
 * The full client — Range-request downloads, PIN pairing, search
 * via pgroonga — lands in PR-3C. PR-3A ships the surface contract
 * only so the (nas)/browse RSC route can render without HTTP
 * calls during the scaffold slice.
 *
 * Every method is async and returns plain data; callers never
 * touch `fetch` directly. When PR-3C fills this in the page will
 * silently start hitting the NAS.
 */

/** A row as the NAS serves it from `GET /api/search`. */
export interface NasBook {
  id: string
  title: string
  author: string
  year: number
  format: string
}

export interface INasClient {
  /** Search the NAS catalog. Empty string lists the first page. */
  search(query: string): Promise<readonly NasBook[]>
}

/**
 * Resolve the NAS base URL. Defaults to the local NestJS backend
 * on `:3000` (the port the sidecar reserves per services/nas-backend
 * src/main.ts). Electron (PR4) overrides this via
 * `ALEJANDRIA_NAS_URL`.
 */
export function resolveNasBaseUrl(): string {
  return process.env['ALEJANDRIA_NAS_URL'] ?? 'http://localhost:3000'
}

/**
 * Open a NAS client. PR-3A returns a stub that resolves to an empty
 * list so the (nas)/browse page renders its empty state during
 * scaffolding. PR-3C replaces the body with real `fetch` calls +
 * bearer-token retrieval from the OS keychain.
 */
export function openNasClient(): INasClient {
  return {
    async search(_query: string): Promise<readonly NasBook[]> {
      // PR-3A skeleton: no NAS row yet. PR-3C will call
      //   GET {baseUrl}/api/search?q=<encoded query>
      // with the bearer token from keychain.
      return []
    },
  }
}