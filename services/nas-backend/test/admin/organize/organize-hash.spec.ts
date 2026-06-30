import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  hashFile,
  hashBuffer,
  primeHash,
} from '../../../src/admin/organize/organize-hash';

/**
 * Contract tests for {@link hashFile} / {@link hashBuffer}.
 *
 * The hash wrapper is the dedupe primitive the analyze step relies
 * on. Two files with the same content MUST yield the same hash; a
 * file with different bytes MUST yield a different hash. The hash
 * surface here mirrors the ``file_hash`` column on
 * ``organize_actions`` (migration 017) so the e2e tests can pin
 * the contract.
 */

describe('organize-hash', () => {
  let tmpDir: string;

  beforeAll(async () => {
    await primeHash();
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-hash-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('hashBuffer returns the same value for identical bytes', () => {
    const a = hashBuffer(Buffer.from('hello world'));
    const b = hashBuffer(Buffer.from('hello world'));
    expect(a).toBe(b);
    // 64-bit xxhash hex string with the ``xxh64:`` prefix.
    expect(a).toMatch(/^xxh64:[0-9a-f]{16}$/);
  });

  it('hashBuffer returns different values for different bytes', () => {
    const a = hashBuffer(Buffer.from('hello world'));
    const b = hashBuffer(Buffer.from('hello WORLD'));
    expect(a).not.toBe(b);
  });

  it('hashFile returns the same hash as hashBuffer for the same bytes', async () => {
    const filePath = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(filePath, 'hello world');
    const fromFile = await hashFile(filePath);
    const fromBuffer = hashBuffer(Buffer.from('hello world'));
    expect(fromFile).toBe(fromBuffer);
  });

  it('hashFile is deterministic across calls on the same file', async () => {
    const filePath = path.join(tmpDir, 'stable.bin');
    fs.writeFileSync(filePath, Buffer.from([1, 2, 3, 4, 5]));
    const first = await hashFile(filePath);
    const second = await hashFile(filePath);
    expect(first).toBe(second);
  });

  it('hashFile differs when bytes differ', async () => {
    const aPath = path.join(tmpDir, 'a.bin');
    const bPath = path.join(tmpDir, 'b.bin');
    fs.writeFileSync(aPath, Buffer.from([1, 2, 3]));
    fs.writeFileSync(bPath, Buffer.from([1, 2, 4]));
    expect(await hashFile(aPath)).not.toBe(await hashFile(bPath));
  });
});
