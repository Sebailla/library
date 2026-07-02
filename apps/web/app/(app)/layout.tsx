import type { ReactNode } from 'react'

import { AppShell } from '@/components/AppShell'

/**
 * `(app)` route group layout — wraps every authenticated page in the
 * persistent AppShell chrome (PR-B, REQ-MAS-001).
 *
 * The route group is intentionally NOT applied to health probes
 * (`/livez`, `/readyz`) nor to Server Actions (`app/_actions/*`):
 * those live in the root layout's tree, not under `(app)`. The
 * server-component here simply delegates the wrapping to the
 * client `AppShell` so React hydration order stays correct.
 */
export default function AppLayout({
  children,
}: {
  children: ReactNode
}): React.JSX.Element {
  return <AppShell>{children}</AppShell>
}
