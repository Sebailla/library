/**
 * Reading progress bar.
 *
 * Pure presentational component — takes the current and total
 * page counts and renders a labelled progress bar plus the
 * derived percentage. No state, no effects, no I/O: safe inside
 * either a React Server Component or a Client Component.
 *
 * Visual styling is intentionally minimal — the design system
 * (PR-3D) will own the look-and-feel. This PR ships only the
 * behaviour contract the reader route needs.
 */
export function ProgressBar({
  currentPage,
  totalPages,
}: {
  currentPage: number
  totalPages: number
}): React.JSX.Element {
  const safeTotal = totalPages > 0 ? totalPages : 1
  const rawPercentage = (currentPage / safeTotal) * 100
  const percentage = Math.max(0, Math.min(100, Math.round(rawPercentage)))

  return (
    <div>
      <div role="progressbar" aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}>
        <span>{percentage}%</span>
      </div>
      <p>
        <span>Page {currentPage} of {totalPages}</span>
      </p>
    </div>
  )
}
