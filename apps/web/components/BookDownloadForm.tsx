'use client'

import { useState, useTransition } from 'react'

import { downloadFromNas, type ActionResult } from '@/app/_actions/nas-actions'
import type { DownloadBookResult } from '@/lib/download/download-flow'
import type { BookRow } from '@/lib/db/local-db'

/**
 * "Download" form for a single NAS book (PR-3C).
 *
 * Submits the book id + device attribution to the
 * `downloadFromNas` Server Action. The action runs the
 * download-flow (start tracking → stream bytes → persist to
 * local SQLite → close tracking) and returns the local file
 * path. The page navigates to `/reader/[bookId]` on success.
 */
export function BookDownloadForm({ book }: { book: BookRow }): React.JSX.Element {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<ActionResult<DownloadBookResult> | null>(null)

  // The deviceId and userId are stable per session for PR-3C.
  // PR-3E will surface them via cookies / IPC.
  const deviceId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `web-${Date.now()}`
  const userId = 'self'
  const deviceName =
    typeof navigator !== 'undefined' && navigator.userAgent
      ? `web-${navigator.userAgent.slice(0, 32)}`
      : 'web-client'

  return (
    <form
      data-testid="book-download-form"
      action={(formData) => {
        startTransition(async () => {
          const r = await downloadFromNas(formData)
          setResult(r)
        })
      }}
      style={{ marginTop: '0.5rem' }}
    >
      <input type="hidden" name="bookId" value={String(book.id)} />
      <input type="hidden" name="deviceId" value={deviceId} />
      <input type="hidden" name="deviceName" value={deviceName} />
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" disabled={isPending}>
        {isPending ? 'Downloading…' : 'Download'}
      </button>
      {result && !result.ok ? (
        <p role="alert" data-testid="download-error">
          {result.error.code}: {result.error.message}
        </p>
      ) : null}
      {result && result.ok ? (
        <p role="status" data-testid="download-success">
          Saved to {result.value.filePath}.
        </p>
      ) : null}
    </form>
  )
}
