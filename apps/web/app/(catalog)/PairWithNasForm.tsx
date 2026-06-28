'use client'

import { useState, useTransition } from 'react'

import { pairDevice, type ActionResult } from '@/app/_actions/nas-actions'
import type { NasPairResponse } from '@/lib/api/nas-client'

/**
 * "Pair with NAS" form (PR-3C).
 *
 * Submits the PIN + a generated device name to the
 * `pairDevice` Server Action. On success the action returns the
 * `token` + `device_id`; the page navigates to `/browse` (PR-3E
 * will add the cookie-set redirect — for PR-3C we just show the
 * token in the UI so the user can confirm pairing worked).
 */
export function PairWithNasForm(): React.JSX.Element {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<ActionResult<NasPairResponse> | null>(null)

  // The "default" device name combines the platform + a stable
  // pseudo-random suffix; the backend stores it in the
  // `devices` table for the per-device download log.
  const defaultDeviceName =
    typeof navigator !== 'undefined' && navigator.userAgent
      ? `web-${navigator.userAgent.slice(0, 32)}`
      : 'web-client'

  return (
    <form
      data-testid="pair-with-nas-form"
      action={(formData) => {
        startTransition(async () => {
          const r = await pairDevice(formData)
          setResult(r)
        })
      }}
      style={{ marginBottom: '1rem' }}
    >
      <h2>Pair with NAS</h2>
      <p>
        Enter the PIN shown on the NAS to mint a bearer token for this device.
      </p>
      <label>
        PIN
        <input name="pin" type="password" required minLength={4} maxLength={16} />
      </label>
      <label>
        Device name
        <input
          name="deviceName"
          type="text"
          required
          minLength={1}
          maxLength={128}
          defaultValue={defaultDeviceName}
        />
      </label>
      <button type="submit" disabled={isPending}>
        {isPending ? 'Pairing…' : 'Pair'}
      </button>
      {result && !result.ok ? (
        <p role="alert" data-testid="pair-error">
          {result.error.code}: {result.error.message}
        </p>
      ) : null}
      {result && result.ok ? (
        <p role="status" data-testid="pair-success">
          Paired as {result.value.device_id}.
        </p>
      ) : null}
    </form>
  )
}
