/**
 * CI guard: regenerate the OpenAPI TS SDK and diff it against the
 * committed copy. Exits non-zero if anything changed — meaning a
 * PR that touched a controller decorator forgot to commit the
 * regenerated client.
 *
 *   $ npm run openapi:check
 *
 * The regeneration is delegated to ``openapi-generate.ts`` so
 * the codegen path stays single-sourced.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CLIENT_FILE = resolve(__dirname, '..', 'clients', 'ts', 'api.d.ts');

function regen(): string {
  // eslint-disable-next-line no-console
  console.log('[openapi:check] regenerating SDK client');
  const cwd = resolve(__dirname, '..');
  execSync(`${resolve(cwd, 'node_modules', '.bin', 'ts-node')} scripts/openapi-generate.ts`, {
    cwd,
    stdio: 'inherit',
  });
  return readFileSync(CLIENT_FILE, 'utf8');
}

function tryReadCommitted(): string | null {
  // The git working copy reflects either the committed version
  // (unchanged branches) or the in-progress version (feature
  // branches). For CI we compare the regenerated content with
  // the working tree, which is exactly the right test: "the
  // working copy is what we just regenerated".
  try {
    return readFileSync(CLIENT_FILE, 'utf8');
  } catch {
    return null;
  }
}

function main(): void {
  const previous = tryReadCommitted();
  regen();
  const current = readFileSync(CLIENT_FILE, 'utf8');
  if (previous === null) {
    // eslint-disable-next-line no-console
    console.error(
      `[openapi:check] FAIL — ${CLIENT_FILE} does not exist. ` +
        `Run \`npm run openapi:generate\` and commit the result.`,
    );
    process.exit(1);
  }
  if (previous !== current) {
    // eslint-disable-next-line no-console
    console.error(
      `[openapi:check] FAIL — regenerated client differs from committed copy.\n` +
        `Run \`npm run openapi:generate\` and commit the regenerated ${CLIENT_FILE}.`,
    );
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log('[openapi:check] OK — regenerated client matches committed copy');
}

main();
