import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'

import {
  nowIso,
  applyOffset,
  hmacHex,
  withPrefix,
  formatOutput,
  generateSignature,
  verifySignature,
  generateInvalidSignature,
  validateRequiredOptions,
  type OutputData,
} from '../../src/lib/signing.js'

describe('Signing Library', () => {
  describe('nowIso', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should return ISO 8601 format with .000Z suffix', () => {
      vi.setSystemTime(new Date('2026-03-03T15:30:45.123Z'))
      const result = nowIso()

      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/)
      expect(result.endsWith('.000Z')).toBe(true)
    })

    it('should truncate milliseconds to .000', () => {
      vi.setSystemTime(new Date('2026-03-03T15:30:45.456Z'))
      const result = nowIso()

      expect(result).toBe('2026-03-03T15:30:45.000Z')
    })

    it('should handle zero milliseconds', () => {
      vi.setSystemTime(new Date('2026-03-03T15:30:45.000Z'))
      const result = nowIso()

      expect(result).toBe('2026-03-03T15:30:45.000Z')
    })
  })

  describe('applyOffset', () => {
    it('should return base timestamp when no offset provided', () => {
      expect(applyOffset('2026-03-03T12:00:00.000Z')).toBe('2026-03-03T12:00:00.000Z')
    })

    it('should subtract seconds', () => {
      expect(applyOffset('2026-03-03T12:05:00.000Z', '-300s')).toBe('2026-03-03T12:00:00.000Z')
    })

    it('should add minutes', () => {
      expect(applyOffset('2026-03-03T12:00:00.000Z', '+2m')).toBe('2026-03-03T12:02:00.000Z')
    })

    it('should subtract hours', () => {
      expect(applyOffset('2026-03-03T12:00:00.000Z', '-1h')).toBe('2026-03-03T11:00:00.000Z')
    })

    it('should throw on invalid offset format', () => {
      expect(() => applyOffset('2026-03-03T12:00:00.000Z', 'bad')).toThrow('Invalid --offset format')
    })
  })

  describe('hmacHex', () => {
    it('should produce consistent hex digest', () => {
      const result = hmacHex('secret', 'my-org/my-repo:2026-03-03T12:00:00.000Z')
      const expected = crypto
        .createHmac('sha256', 'secret')
        .update('my-org/my-repo:2026-03-03T12:00:00.000Z')
        .digest('hex')

      expect(result).toBe(expected)
    })

    it('should produce lowercase hex', () => {
      const result = hmacHex('secret', 'payload')
      expect(result).toMatch(/^[0-9a-f]{64}$/)
    })

    it('should produce 64-character hex string', () => {
      const result = hmacHex('key', 'data')
      expect(result).toHaveLength(64)
    })
  })

  describe('withPrefix', () => {
    it('should add sha256= prefix by default', () => {
      expect(withPrefix('abc123')).toBe('sha256=abc123')
    })

    it('should use custom prefix', () => {
      expect(withPrefix('abc123', 'custom=')).toBe('custom=abc123')
    })

    it('should allow empty prefix', () => {
      expect(withPrefix('abc123', '')).toBe('abc123')
    })
  })

  describe('formatOutput', () => {
    it('should format output with all fields', () => {
      const data: OutputData = {
        repo: 'my-org/my-repo',
        timestamp: '2026-03-03T12:00:00.000Z',
        signature: 'abc123',
        prefix: 'sha256=',
      }
      const output = formatOutput(data)

      expect(output).toContain('Repository: my-org/my-repo')
      expect(output).toContain('Timestamp: 2026-03-03T12:00:00.000Z')
      expect(output).toContain('Signature: sha256=abc123')
      expect(output).toContain('X-Hub-Repository: my-org/my-repo')
      expect(output).toContain('X-Hub-Timestamp: 2026-03-03T12:00:00.000Z')
      expect(output).toContain('X-Hub-Signature-256: sha256=abc123')
    })
  })

  describe('generateSignature', () => {
    it('should generate a valid signature for given repo and secret', () => {
      const result = generateSignature({
        repo: 'my-org/my-repo',
        secret: 'test-secret',
        timestamp: '2026-03-03T12:00:00.000Z',
      })

      expect(result.repo).toBe('my-org/my-repo')
      expect(result.timestamp).toBe('2026-03-03T12:00:00.000Z')
      expect(result.prefix).toBe('sha256=')
      expect(result.signature).toMatch(/^[0-9a-f]{64}$/)
    })

    it('should produce deterministic output for same inputs', () => {
      const opts = { repo: 'org/repo', secret: 's', timestamp: '2026-01-01T00:00:00.000Z' }
      const a = generateSignature(opts)
      const b = generateSignature(opts)
      expect(a.signature).toBe(b.signature)
    })

    it('should produce different signature for different secrets', () => {
      const base = { repo: 'org/repo', timestamp: '2026-01-01T00:00:00.000Z' }
      const a = generateSignature({ ...base, secret: 'secret-a' })
      const b = generateSignature({ ...base, secret: 'secret-b' })
      expect(a.signature).not.toBe(b.signature)
    })

    it('should apply offset when provided', () => {
      const result = generateSignature({
        repo: 'org/repo',
        secret: 's',
        timestamp: '2026-03-03T12:05:00.000Z',
        offset: '-300s',
      })
      expect(result.timestamp).toBe('2026-03-03T12:00:00.000Z')
    })

    it('should uppercase signature when upper is true', () => {
      const result = generateSignature({
        repo: 'org/repo',
        secret: 's',
        timestamp: '2026-01-01T00:00:00.000Z',
        upper: true,
      })
      expect(result.signature).toMatch(/^[0-9A-F]{64}$/)
    })
  })

  describe('verifySignature', () => {
    it('should verify a correct signature', () => {
      const generated = generateSignature({
        repo: 'org/repo',
        secret: 'test-secret',
        timestamp: '2026-03-03T12:00:00.000Z',
      })
      const result = verifySignature({
        repo: 'org/repo',
        secret: 'test-secret',
        timestamp: '2026-03-03T12:00:00.000Z',
        signature: `sha256=${generated.signature}`,
      })
      expect(result.match).toBe(true)
    })

    it('should reject an incorrect signature', () => {
      const result = verifySignature({
        repo: 'org/repo',
        secret: 'test-secret',
        timestamp: '2026-03-03T12:00:00.000Z',
        signature: 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
      })
      expect(result.match).toBe(false)
    })

    it('should be case-insensitive on provided signature', () => {
      const generated = generateSignature({
        repo: 'org/repo',
        secret: 's',
        timestamp: '2026-01-01T00:00:00.000Z',
      })
      const result = verifySignature({
        repo: 'org/repo',
        secret: 's',
        timestamp: '2026-01-01T00:00:00.000Z',
        signature: `sha256=${generated.signature.toUpperCase()}`,
      })
      expect(result.match).toBe(true)
    })
  })

  describe('generateInvalidSignature', () => {
    it('should generate wrong-secret kind that does not match', () => {
      const valid = generateSignature({
        repo: 'org/repo',
        secret: 'real-secret',
        timestamp: '2026-01-01T00:00:00.000Z',
      })
      const invalid = generateInvalidSignature({
        repo: 'org/repo',
        secret: 'real-secret',
        kind: 'wrong-secret',
        timestamp: '2026-01-01T00:00:00.000Z',
      })
      expect(invalid.signature).not.toBe(valid.signature)
    })

    it('should generate no-prefix kind with empty prefix', () => {
      const result = generateInvalidSignature({
        repo: 'org/repo',
        secret: 's',
        kind: 'no-prefix',
        timestamp: '2026-01-01T00:00:00.000Z',
      })
      expect(result.prefix).toBe('')
    })

    it('should throw on unknown kind', () => {
      expect(() =>
        generateInvalidSignature({
          repo: 'org/repo',
          secret: 's',
          kind: 'bogus' as any,
          timestamp: '2026-01-01T00:00:00.000Z',
        })
      ).toThrow('Invalid kind')
    })
  })

  describe('validateRequiredOptions', () => {
    it('should return error when repo is missing', () => {
      const result = validateRequiredOptions('', 'secret', 'generate')
      expect(result).not.toBeNull()
      expect(result!.error).toContain('--repo')
    })

    it('should return error when secret is missing for generate mode', () => {
      const result = validateRequiredOptions('org/repo', '', 'generate')
      expect(result).not.toBeNull()
      expect(result!.error).toContain('--secret')
    })

    it('should return null when valid', () => {
      const result = validateRequiredOptions('org/repo', 'secret', 'generate')
      expect(result).toBeNull()
    })
  })
})
