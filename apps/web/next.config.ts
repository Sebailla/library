import type { NextConfig } from 'next'

/**
 * Next.js 16 configuration for `@alejandria/web` (PR-3A scaffold).
 *
 * - `cacheComponents: true` enables Partial Prerendering + the `'use cache'`
 *   directive required by `openspec/.../nextjs-app-shell/spec.md`.
 * - React Strict Mode surfaces unsafe effects early in dev.
 */
const nextConfig: NextConfig = {
  cacheComponents: true,
  reactStrictMode: true,
}

export default nextConfig