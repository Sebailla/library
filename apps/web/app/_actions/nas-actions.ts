'use server'

/**
 * Server Actions for the NAS pair / refresh / download flow
 * (PR-3C).
 *
 * Per the `nas-browse-download` spec these actions are invoked
 * from RSC forms on the (nas)/browse route. They are thin
 * adapters — the real work lives in `lib/api/nas-client.ts` and
 * `lib/download/download-flow.ts`. Returning a serialisable
 * `Result<T, E>` keeps the page free of try/catch noise.
 *
 * The `'use server'` directive is required by Next.js 16 for
 * any module under `app/_actions/`. It marks every export as
 * a Server Action callable from RSC forms; the framework wires
 * the RPC at build time.
 */

import { createNasClient, type INasClient, type NasPairResponse } from '@/lib/api/nas-client'
import { downloadBook, type DownloadBookResult } from '@/lib/download/download-flow'
import { logError } from '@/lib/log'
import { scanFile } from '@/lib/scan/local-pipeline'

/** Discriminated union the page can render without try/catch. */
export type ActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }

function ok<T>(value: T): ActionResult<T> {
  return { ok: true, value }
}

function fail<T = never>(code: string, message: string): ActionResult<T> {
  return { ok: false, error: { code, message } }
}

function readField(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

function isNasHttpError(err: unknown): err is { status: number; code: string | null; message: string } {
  if (typeof err !== 'object' || err === null) return false
  const candidate = err as { status?: unknown; code?: unknown; message?: unknown }
  return typeof candidate.status === 'number' && typeof candidate.message === 'string'
}

/**
 * Pair this device with the NAS. Reads the PIN + device name
 * from the FormData and returns the token + device id on
 * success. The page is expected to persist the token in a
 * `httpOnly` cookie in PR-3E (out of scope for PR-3C).
 */
export async function pairDevice(
  formData: FormData,
): Promise<ActionResult<NasPairResponse>> {
  const pin = readField(formData, 'pin').trim()
  const deviceName = readField(formData, 'deviceName').trim()
  if (pin.length < 4) return fail('VALIDATION', 'PIN must be at least 4 characters')
  if (deviceName.length === 0) return fail('VALIDATION', 'Device name is required')

  const client = createNasClient()
  try {
    const response = await client.pair({ pin, deviceName })
    return ok(response)
  } catch (err) {
    const code = isNasHttpError(err) ? err.code ?? 'NAS_ERROR' : 'UNEXPECTED'
    logError('nas-actions.pairDevice', err, { pinLength: pin.length, code })
    if (isNasHttpError(err)) {
      return fail(err.code ?? 'NAS_ERROR', err.message)
    }
    return fail('UNEXPECTED', err instanceof Error ? err.message : 'Unknown error')
  }
}

/**
 * Rotate the bearer token. The token comes from the FormData so
 * the test can drive the action without a real cookie jar; in
 * production the page will inject the cookie value via
 * `cookies()` (PR-3E wires that helper).
 */
export async function refreshToken(
  formData: FormData,
): Promise<ActionResult<NasPairResponse>> {
  const token = readField(formData, 'token').trim()
  if (token.length === 0) return fail('VALIDATION', 'Bearer token is required')

  const client = createNasClient({ token })
  try {
    return ok(await client.refresh())
  } catch (err) {
    const code = isNasHttpError(err) ? err.code ?? 'NAS_ERROR' : 'UNEXPECTED'
    logError('nas-actions.refreshToken', err, { hasToken: token.length > 0, code })
    if (isNasHttpError(err)) {
      return fail(err.code ?? 'NAS_ERROR', err.message)
    }
    return fail('UNEXPECTED', err instanceof Error ? err.message : 'Unknown error')
  }
}

/**
 * Download a book from the NAS, persist it locally, and close
 * the tracking row. The page is expected to redirect to
 * `/reader/[bookId]` on success.
 */
export async function downloadFromNas(
  formData: FormData,
): Promise<ActionResult<DownloadBookResult>> {
  const bookIdRaw = readField(formData, 'bookId')
  const deviceId = readField(formData, 'deviceId')
  const deviceName = readField(formData, 'deviceName')
  const userId = readField(formData, 'userId')
  const bookId = Number.parseInt(bookIdRaw, 10)
  if (!Number.isFinite(bookId) || bookId <= 0) {
    return fail('VALIDATION', 'bookId must be a positive integer')
  }
  if (deviceId.length === 0) return fail('VALIDATION', 'deviceId is required')
  if (deviceName.length === 0) return fail('VALIDATION', 'deviceName is required')
  if (userId.length === 0) return fail('VALIDATION', 'userId is required')

  const token = readField(formData, 'token')
  const client: INasClient = createNasClient({ token: token || undefined })

  try {
    // The destination path is resolved from the local DB layout —
    // PR-3B already gave us the convention. PR-3E will surface
    // a custom dir via a user preference.
    const { join } = await import('node:path')
    const destPath = join(process.cwd(), 'data', 'books', `${bookId}.bin`)
    const result = await downloadBook({
      bookId,
      deviceId,
      deviceName,
      userId,
      destPath,
      nasClient: client,
    })
    return ok(result)
  } catch (err) {
    const code = isNasHttpError(err) ? err.code ?? 'NAS_ERROR' : 'UNEXPECTED'
    logError('nas-actions.downloadFromNas', err, { bookId, code })
    if (isNasHttpError(err)) {
      return fail(err.code ?? 'NAS_ERROR', err.message)
    }
    return fail('UNEXPECTED', err instanceof Error ? err.message : 'Unknown error')
  }
}

/**
 * Scan a local file through the PR1 sidecar and persist the
 * resulting metadata to the local SQLite.
 */
export async function scanLocalFolder(
  formData: FormData,
): Promise<ActionResult<{ id: string; title: string; filePath: string }>> {
  const filePath = readField(formData, 'filePath').trim()
  if (filePath.length === 0) return fail('VALIDATION', 'filePath is required')
  try {
    const row = await scanFile(filePath)
    return ok({ id: row.id, title: row.title, filePath: row.filePath })
  } catch (err) {
    logError('nas-actions.scanLocalFolder', err, { filePath })
    return fail('SCAN_ERROR', err instanceof Error ? err.message : 'Unknown error')
  }
}
