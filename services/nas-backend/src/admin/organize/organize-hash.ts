import * as fs from 'fs';
import xxhashWasmInit, { XXHashAPI } from 'xxhash-wasm';

/**
 * xxh64 dedupe wrapper for the admin organize surface (PR-N5).
 *
 * Wraps the xxh64 implementation loaded via the ``xxhash-wasm``
 * package so the dedupe primitive can run unchanged in Node 20+,
 * Bun, and V8 isolates. The wasm module is loaded once on first
 * use and reused for every subsequent hash call.
 *
 * The {@link hashBuffer} / {@link hashFile} pair are the only
 * public surface. The output is prefixed with the algorithm tag
 * (``xxh64:``) so a future migration to a different hash family
 * can disambiguate without a schema migration on
 * ``organize_actions.file_hash`` (migration 017).
 *
 * Pure, deterministic, allocation-light: every call returns the
 * same hex string for the same input bytes, which is the dedupe
 * guarantee {@link OrganizeService.analyze} relies on.
 */

let cached: XXHashAPI | null = null;
let loadPromise: Promise<XXHashAPI> | null = null;

async function getHasher(): Promise<XXHashAPI> {
  if (cached) return cached;
  if (!loadPromise) {
    loadPromise = xxhashWasmInit().then((h) => {
      cached = h;
      return h;
    });
  }
  return loadPromise;
}

/**
 * Synchronous buffer hash.
 *
 * ``h64Raw`` is a sync call on the loaded wasm module. Tests that
 * hit the sync surface MUST call {@link primeHash} (via
 * ``beforeAll``) so the loader has resolved. Application code in
 * the analyze path uses {@link hashFile} which primes lazily.
 */
export function hashBuffer(buf: Buffer): string {
  if (!cached) {
    throw new Error(
      'organize-hash: call await primeHash() before hashBuffer()',
    );
  }
  // ``Buffer`` is a Uint8Array subclass so this typechecks.
  const digest = cached.h64Raw(buf as unknown as Uint8Array);
  return `xxh64:${digest.toString(16).padStart(16, '0')}`;
}

/**
 * Async file-content hash. Reads the whole file via
 * ``fs.promises.readFile`` (the analyze step walks the folder
 * without concurrency pressure, so streaming is unnecessary) and
 * runs the same algorithm as {@link hashBuffer}.
 */
export async function hashFile(filePath: string): Promise<string> {
  const hasher = await getHasher();
  const buf = await fs.promises.readFile(filePath);
  const digest = hasher.h64Raw(buf as unknown as Uint8Array);
  return `xxh64:${digest.toString(16).padStart(16, '0')}`;
}

/**
 * Initialise the wasm hash module. Idempotent and cheap to call
 * repeatedly; the underlying loader caches the singleton.
 *
 * Callers that need the sync {@link hashBuffer} MUST prime the
 * module first. Async callers (the analyze step's file walker)
 * rely on {@link hashFile} which primes lazily.
 */
export async function primeHash(): Promise<void> {
  await getHasher();
}
