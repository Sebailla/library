import { describe, expect, it } from 'vitest'

/**
 * TDD tests for `src/sidecar-client.ts` (PR-4C, issue #75).
 *
 * The Python sidecar emits a versioned JSON envelope on stdout:
 *
 *   Success: `{ schema_version: 1, result: { book_id, title, ... } }`
 *   Error:   `{ schema_version: 1, error:  { code, message } }`
 *
 * `parseSidecarEnvelope` is the boundary between the untrusted
 * string from a child process and a typed object the rest of the
 * main process can consume. It MUST:
 *
 *   1. Tolerate trailing whitespace / newlines on the input.
 *   2. Throw a descriptive `Error` on invalid JSON.
 *   3. Throw on envelopes missing `schema_version`, `result`,
 *      or `error`.
 *   4. Reject unsupported `schema_version` values.
 *   5. Surface sidecar error envelopes as a `SidecarEnvelopeError`
 *      carrying the original code + message so the IPC layer can
 *      propagate them.
 *   6. Return the typed `result` object on success envelopes.
 */

describe('sidecar-client envelope parser (PR-4C)', () => {
  it('parses a success envelope and returns the typed result', async () => {
    const { parseSidecarEnvelope } = await import('../src/sidecar-client')

    const stdout = JSON.stringify({
      schema_version: 1,
      result: {
        book_id: 'b-1',
        title: 'Rayuela',
        author: 'Julio Cortázar',
        year: 1963,
        format: 'epub',
        content_hash: 'sha256:abc',
        excerpt: 'Una novela',
      },
    })

    const parsed = parseSidecarEnvelope(stdout) as {
      book_id: string
      title: string
      author: string
      year: number
      format: string
      content_hash: string
      excerpt: string
    }

    expect(parsed.book_id).toBe('b-1')
    expect(parsed.title).toBe('Rayuela')
    expect(parsed.author).toBe('Julio Cortázar')
    expect(parsed.year).toBe(1963)
    expect(parsed.format).toBe('epub')
    expect(parsed.content_hash).toBe('sha256:abc')
    expect(parsed.excerpt).toBe('Una novela')
  })

  it('tolerates leading and trailing whitespace around the JSON payload', async () => {
    const { parseSidecarEnvelope } = await import('../src/sidecar-client')

    const stdout =
      '\n  ' +
      JSON.stringify({
        schema_version: 1,
        result: { book_id: 'b-2', title: 'X', author: 'Y', year: 2020, format: 'pdf', content_hash: 'h', excerpt: '' },
      }) +
      '   \n'

    const parsed = parseSidecarEnvelope(stdout) as { book_id: string }
    expect(parsed.book_id).toBe('b-2')
  })

  it('throws a descriptive Error when the input is not valid JSON', async () => {
    const { parseSidecarEnvelope } = await import('../src/sidecar-client')

    expect(() => parseSidecarEnvelope('not json at all')).toThrow(/invalid JSON/)
  })

  it('throws when the envelope is missing schema_version', async () => {
    const { parseSidecarEnvelope } = await import('../src/sidecar-client')

    const stdout = JSON.stringify({ result: { book_id: 'b-3' } })
    expect(() => parseSidecarEnvelope(stdout)).toThrow(/schema_version/)
  })

  it('throws when the envelope is missing both result and error', async () => {
    const { parseSidecarEnvelope } = await import('../src/sidecar-client')

    const stdout = JSON.stringify({ schema_version: 1 })
    expect(() => parseSidecarEnvelope(stdout)).toThrow(/result.*error|error.*result/)
  })

  it('rejects unsupported schema_version values', async () => {
    const { parseSidecarEnvelope } = await import('../src/sidecar-client')

    const stdout = JSON.stringify({ schema_version: 99, result: { book_id: 'b-4' } })
    expect(() => parseSidecarEnvelope(stdout)).toThrow(/schema_version.*99/)
  })

  it('raises SidecarEnvelopeError on a sidecar error envelope, preserving code + message', async () => {
    const { parseSidecarEnvelope, SidecarEnvelopeError } = await import('../src/sidecar-client')

    const stdout = JSON.stringify({
      schema_version: 1,
      error: { code: 'FILE_UNREADABLE', message: 'cannot read /etc/passwd' },
    })

    expect(() => parseSidecarEnvelope(stdout)).toThrow(SidecarEnvelopeError)
    try {
      parseSidecarEnvelope(stdout)
    } catch (err) {
      expect(err).toBeInstanceOf(SidecarEnvelopeError)
      const e = err as InstanceType<typeof SidecarEnvelopeError>
      expect(e.code).toBe('FILE_UNREADABLE')
      expect(e.message).toContain('cannot read /etc/passwd')
    }
  })

  it('preserves the result excerpt when present and falls back to "" when missing', async () => {
    const { parseSidecarEnvelope } = await import('../src/sidecar-client')

    const withExcerpt = JSON.stringify({
      schema_version: 1,
      result: { book_id: 'b-5', title: 't', author: 'a', year: 2000, format: 'pdf', content_hash: 'h', excerpt: 'hello' },
    })
    expect((parseSidecarEnvelope(withExcerpt) as { excerpt: string }).excerpt).toBe('hello')

    const withoutExcerpt = JSON.stringify({
      schema_version: 1,
      result: { book_id: 'b-6', title: 't', author: 'a', year: 2000, format: 'pdf', content_hash: 'h' },
    })
    expect((parseSidecarEnvelope(withoutExcerpt) as { excerpt: string }).excerpt).toBe('')
  })
})
