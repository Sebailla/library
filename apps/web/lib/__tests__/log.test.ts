import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * TDD tests for `lib/log.ts` (PR-3-fix-C, issue #61).
 *
 * The web app ships ZERO observability. PR-3-fix-C introduces a
 * structured logger with:
 *
 *  - Three levels: `info`, `warn`, `error`
 *  - JSON output in production, pretty output in dev (test env)
 *  - `logError(scope, err, { context })` captures the error's
 *    `name`, `message`, and `stack` so a debugger doesn't have
 *    to fish through `console.error` text
 *  - `requestId` is attached to the record when one is set
 *    via {@link setRequestId}
 *
 * The writer is injected via {@link setWriter} so the tests
 * can capture the emitted records without monkey-patching
 * `console` (which is global state shared with React Testing
 * Library + jsdom and would produce noisy output on every test).
 */

import {
  info,
  warn,
  logError,
  setRequestId,
  clearRequestId,
  setWriter,
  formatLog,
  type LogRecord,
  type LogWriter,
} from '../log'

describe('lib/log (PR-3-fix-C, #61)', () => {
  let captured: LogRecord[]
  let writer: LogWriter

  beforeEach(() => {
    captured = []
    writer = (record) => {
      captured.push(record)
    }
    setWriter(writer)
    clearRequestId()
  })

  describe('formatLog', () => {
    it('emits a JSON line with timestamp, level, scope, message', () => {
      const line = formatLog(
        {
          timestamp: '2026-06-29T12:00:00.000Z',
          level: 'info',
          scope: 'test',
          message: 'hello',
        },
        false,
      )
      expect(JSON.parse(line)).toEqual({
        timestamp: '2026-06-29T12:00:00.000Z',
        level: 'info',
        scope: 'test',
        message: 'hello',
      })
    })

    it('omits empty optional fields from the JSON output', () => {
      const line = formatLog(
        {
          timestamp: '2026-06-29T12:00:00.000Z',
          level: 'warn',
          scope: 'test',
          message: 'noisy',
        },
        false,
      )
      const parsed = JSON.parse(line)
      expect(parsed).not.toHaveProperty('requestId')
      expect(parsed).not.toHaveProperty('context')
      expect(parsed).not.toHaveProperty('error')
    })

    it('includes context keys when supplied', () => {
      const line = formatLog(
        {
          timestamp: '2026-06-29T12:00:00.000Z',
          level: 'info',
          scope: 'test',
          message: 'ok',
          context: { userId: 'u-1', bookId: 7 },
        },
        false,
      )
      const parsed = JSON.parse(line)
      expect(parsed.context).toEqual({ userId: 'u-1', bookId: 7 })
    })

    it('pretty-printer produces a human readable single line', () => {
      const line = formatLog(
        {
          timestamp: '2026-06-29T12:00:00.000Z',
          level: 'error',
          scope: 'scan',
          message: 'failed',
          error: { name: 'Error', message: 'boom', stack: 'Error: boom\n  at <stack>' },
        },
        true,
      )
      // Pretty format is non-JSON but stable: contains the
      // UPPERCASE level marker, scope, message, error name,
      // error message, and the first stack frame.
      expect(line).toContain('[ERROR]')
      expect(line).toContain('scan')
      expect(line).toContain('failed')
      expect(line).toContain('boom')
      expect(line).toContain('<stack>')
    })
  })

  describe('info / warn', () => {
    it('info writes a record with level=info, scope, message', () => {
      info('test', 'starting', { step: 1 })
      expect(captured).toHaveLength(1)
      const r = captured[0]!
      expect(r.level).toBe('info')
      expect(r.scope).toBe('test')
      expect(r.message).toBe('starting')
      expect(r.context).toEqual({ step: 1 })
      expect(typeof r.timestamp).toBe('string')
    })

    it('warn writes a record with level=warn', () => {
      warn('test', 'degraded', { latencyMs: 500 })
      expect(captured).toHaveLength(1)
      expect(captured[0]?.level).toBe('warn')
      expect(captured[0]?.context).toEqual({ latencyMs: 500 })
    })
  })

  describe('logError', () => {
    it('captures error.name, message, and stack', () => {
      const err = new Error('boom')
      err.name = 'BoomError'
      logError('scan', err, { filePath: '/library/x.pdf' })
      expect(captured).toHaveLength(1)
      const r = captured[0]!
      expect(r.level).toBe('error')
      expect(r.scope).toBe('scan')
      expect(r.context).toEqual({ filePath: '/library/x.pdf' })
      expect(r.error?.name).toBe('BoomError')
      expect(r.error?.message).toBe('boom')
      expect(typeof r.error?.stack).toBe('string')
      expect(r.error?.stack).toContain('boom')
    })

    it('handles non-Error throws (string, plain object)', () => {
      logError('scan', 'just a string', { hint: 'no err ctor' })
      const r = captured[0]!
      expect(r.error?.name).toBe('NonError')
      expect(r.error?.message).toBe('just a string')
      expect(r.error?.stack).toBeUndefined()
    })

    it('handles undefined error', () => {
      logError('scan', undefined)
      const r = captured[0]!
      expect(r.error?.message).toBe('undefined')
    })
  })

  describe('requestId propagation', () => {
    it('attaches requestId when set via setRequestId', () => {
      setRequestId('req-abc-123')
      info('test', 'hello')
      expect(captured[0]?.requestId).toBe('req-abc-123')
    })

    it('omits requestId when not set', () => {
      info('test', 'hello')
      expect(captured[0]?.requestId).toBeUndefined()
    })

    it('clearRequestId removes the attached id', () => {
      setRequestId('req-1')
      clearRequestId()
      info('test', 'hello')
      expect(captured[0]?.requestId).toBeUndefined()
    })
  })

  describe('writer integration', () => {
    it('uses the injected writer instead of console', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        info('test', 'silent')
        expect(consoleSpy).not.toHaveBeenCalled()
        expect(captured).toHaveLength(1)
      } finally {
        consoleSpy.mockRestore()
      }
    })
  })
})