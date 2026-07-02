import path from 'path'
import type { NextConfig } from 'next'

/**
 * Next.js 16 configuration for `@alejandria/web` (PR-3A scaffold;
 * PR-fix-mac-window-standalone-bundle).
 *
 * - `cacheComponents: true` enables Partial Prerendering + the `'use cache'`
 *   directive required by `openspec/.../nextjs-app-shell/spec.md`.
 * - `output: 'standalone'` produces a self-contained Node server at
 *   `.next/standalone/` that the Mac `.app` can spawn as a child
 *   process (see `apps/mac/src/standalone-server.ts`). Without this
 *   the Mac package step would only ship a webpack chunked build,
 *   which Electron cannot `loadURL`.
 * - `outputFileTracingRoot` pins the file tracer to the monorepo root so the
 *   standalone bundle doesn't trace all the way up to the user's home
 *   directory (which creates a recursive tree and hangs electron-forge's
 *   packager). Must be an absolute path — relative paths confuse the
 *   nft tracer in monorepo contexts.
 * - React Strict Mode surfaces unsafe effects early in dev.
 */
const nextConfig: NextConfig = {
  cacheComponents: true,
  output: 'standalone',
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '../../'),
}

export default nextConfig