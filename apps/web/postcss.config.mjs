/**
 * PostCSS config for `@alejandria/web` (PR-A, REQ-MVF-002).
 *
 * Tailwind v4 is configured entirely in CSS via `@import "tailwindcss"` +
 * `@theme { ... }` blocks in `apps/web/app/globals.css`. There is no
 * `tailwind.config.js`. The PostCSS plugin must be the first entry so
 * any downstream PostCSS plugins see the Tailwind output.
 */
export default {
  plugins: { '@tailwindcss/postcss': {} },
}