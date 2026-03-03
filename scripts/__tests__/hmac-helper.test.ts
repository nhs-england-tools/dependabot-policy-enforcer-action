import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import crypto from 'node:crypto'
import http from 'node:http'
import {
  parseArgs,
  nowIso,
  applyOffset,
  hmacHex,
  withPrefix,
  formatOutput,
  generateSignature,
  verifySignature,
  generateInvalidSignature,
  validateRequiredOptions,
  handleGenerate,
  handleVerify,
  handleInvalid,
  executeCommand,
  type OutputData,
  type GenerateOptions,
  type VerifyOptions,
  type InvalidOptions,
  type GenerateHandlerOptions,
  type VerifyHandlerOptions,
  type InvalidHandlerOptions,
  type ExecuteCommandOptions,
} from '../hmac-helper'

describe('HMAC Helper Functions', () => {
  describe('parseArgs', () => {
    it('should parse mode correctly', () => {
      const result = parseArgs(['node', 'script.ts', 'generate'])
      expect(result.mode).toBe('generate')
    })

    it('should default to generate mode', () => {
      const result = parseArgs(['node', 'script.ts'])
      expect(result.mode).toBe('generate')
    })

    it('should parse string options with equals', () => {
      const result = parseArgs(['node', 'script.ts', 'generate', '--repo=test-org/test'])
      expect(result.opts.repo).toBe('test-org/test')
    })

    it('should parse boolean flags', () => {
      const result = parseArgs(['node', 'script.ts', 'generate', '--upper'])
      expect(result.opts.upper).toBe(true)
    })

    it('should parse multiple options', () => {
      const result = parseArgs([
        'node',
        'script.ts',
        'verify',
        '--repo=test-org/test',
        '--secret=mysecret',
        '--upper',
      ])
      expect(result.mode).toBe('verify')
      expect(result.opts.repo).toBe('test-org/test')
      expect(result.opts.secret).toBe('mysecret')
      expect(result.opts.upper).toBe(true)
    })

    it('should parse space-separated option values', () => {
      const result = parseArgs(['node', 'script.ts', 'generate', '--repo', 'test-org/test'])
      expect(result.opts.repo).toBe('test-org/test')
    })

    it('should parse multiple space-separated options', () => {
      const result = parseArgs([
        'node',
        'script.ts',
        'generate',
        '--repo',
        'test-org/test',
        '--secret',
        'my-secret',
        '--timestamp',
        '2025-12-07T12:00:00.000Z',
      ])
      expect(result.opts.repo).toBe('test-org/test')
      expect(result.opts.secret).toBe('my-secret')
      expect(result.opts.timestamp).toBe('2025-12-07T12:00:00.000Z')
    })

    it('should parse mixed equals and space-separated formats', () => {
      const result = parseArgs([
        'node',
        'script.ts',
        'verify',
        '--repo=test-org/test',
        '--secret',
        'my-secret',
        '--timestamp',
        '2025-12-07T12:00:00.000Z',
        '--upper',
      ])
      expect(result.opts.repo).toBe('test-org/test')
      expect(result.opts.secret).toBe('my-secret')
      expect(result.opts.timestamp).toBe('2025-12-07T12:00:00.000Z')
      expect(result.opts.upper).toBe(true)
    })

    it('should treat option as boolean flag when next arg starts with --', () => {
      const result = parseArgs([
        'node',
        'script.ts',
        'generate',
        '--upper',
        '--repo',
        'test-org/test',
      ])
      expect(result.opts.upper).toBe(true)
      expect(result.opts.repo).toBe('test-org/test')
    })

    it('should handle space-separated values with special characters', () => {
      const result = parseArgs([
        'node',
        'script.ts',
        'generate',
        '--repo',
        'test-org/test-repo',
        '--prefix',
        'sha256=',
      ])
      expect(result.opts.repo).toBe('test-org/test-repo')
      expect(result.opts.prefix).toBe('sha256=')
    })

    it('should handle option at end as boolean flag', () => {
      const result = parseArgs([
        'node',
        'script.ts',
        'generate',
        '--repo',
        'test-org/test',
        '--upper',
      ])
      expect(result.opts.repo).toBe('test-org/test')
      expect(result.opts.upper).toBe(true)
    })

    it('should parse offset with space-separated format', () => {
      const result = parseArgs([
        'node',
        'script.ts',
        'generate',
        '--repo',
        'test-org/test',
        '--offset',
        '-300s',
      ])
      expect(result.opts.repo).toBe('test-org/test')
      expect(result.opts.offset).toBe('-300s')
    })
  })

  describe('nowIso', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should return ISO 8601 format with .000Z suffix', () => {
      vi.setSystemTime(new Date('2025-12-07T15:30:45.123Z'))
      const result = nowIso()

      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/)
      expect(result.endsWith('.000Z')).toBe(true)
    })

    it('should truncate milliseconds to .000', () => {
      vi.setSystemTime(new Date('2025-12-07T15:30:45.456Z'))
      const result = nowIso()

      expect(result).toBe('2025-12-07T15:30:45.000Z')
    })

    it('should handle zero milliseconds', () => {
      vi.setSystemTime(new Date('2025-12-07T15:30:45.000Z'))
      const result = nowIso()

      expect(result).toBe('2025-12-07T15:30:45.000Z')
    })

    it('should handle 999 milliseconds by truncating to previous second', () => {
      vi.setSystemTime(new Date('2025-12-07T15:30:45.999Z'))
      const result = nowIso()

      expect(result).toBe('2025-12-07T15:30:45.000Z')
    })

    it('should handle single digit milliseconds', () => {
      vi.setSystemTime(new Date('2025-12-07T15:30:45.001Z'))
      const result = nowIso()

      expect(result).toBe('2025-12-07T15:30:45.000Z')
    })

    it('should return consistent format across different times', () => {
      const times = [
        '2025-01-01T00:00:00.123Z',
        '2025-06-15T12:30:45.789Z',
        '2025-12-31T23:59:59.500Z',
      ]

      times.forEach(time => {
        vi.setSystemTime(new Date(time))
        const result = nowIso()

        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/)
        expect(result.endsWith('.000Z')).toBe(true)
      })
    })

    it('should be valid for HMAC payload generation', () => {
      vi.setSystemTime(new Date('2025-12-07T15:30:45.789Z'))
      const timestamp = nowIso()
      const repo = 'test-org/test-repo'
      const payload = `${repo}:${timestamp}`

      // Should not throw and should generate valid signature
      expect(() => hmacHex('secret', payload)).not.toThrow()
      expect(hmacHex('secret', payload)).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should produce parseable timestamp', () => {
      vi.setSystemTime(new Date('2025-12-07T15:30:45.456Z'))
      const result = nowIso()

      // Should be parseable as a valid date
      const parsed = new Date(result)
      expect(parsed.toISOString()).toBe('2025-12-07T15:30:45.000Z')
      expect(parsed.getUTCFullYear()).toBe(2025)
      expect(parsed.getUTCMonth()).toBe(11) // December (0-indexed)
      expect(parsed.getUTCDate()).toBe(7)
      expect(parsed.getUTCHours()).toBe(15)
      expect(parsed.getUTCMinutes()).toBe(30)
      expect(parsed.getUTCSeconds()).toBe(45)
      expect(parsed.getUTCMilliseconds()).toBe(0)
    })
  })

  describe('applyOffset', () => {
    const baseTime = '2025-01-01T12:00:00.000Z'

    it('should return base time when no offset provided', () => {
      expect(applyOffset(baseTime)).toBe(baseTime)
      expect(applyOffset(baseTime, undefined)).toBe(baseTime)
    })

    it('should subtract seconds with negative offset', () => {
      const result = applyOffset(baseTime, '-300s')
      expect(result).toBe('2025-01-01T11:55:00.000Z')
    })

    it('should add seconds with positive offset', () => {
      const result = applyOffset(baseTime, '+30s')
      expect(result).toBe('2025-01-01T12:00:30.000Z')
    })

    it('should handle minutes offset', () => {
      const result = applyOffset(baseTime, '-5m')
      expect(result).toBe('2025-01-01T11:55:00.000Z')
    })

    it('should handle hours offset', () => {
      const result = applyOffset(baseTime, '+2h')
      expect(result).toBe('2025-01-01T14:00:00.000Z')
    })

    it('should handle offset without sign as positive', () => {
      const result = applyOffset(baseTime, '10s')
      expect(result).toBe('2025-01-01T12:00:10.000Z')
    })

    it('should throw error for invalid offset format', () => {
      expect(() => applyOffset(baseTime, 'invalid')).toThrow('Invalid --offset format')
      expect(() => applyOffset(baseTime, '10')).toThrow('Invalid --offset format')
      expect(() => applyOffset(baseTime, '10x')).toThrow('Invalid --offset format')
    })
  })

  describe('hmacHex', () => {
    it('should generate correct HMAC signature', () => {
      const secret = 'test-secret'
      const payload = 'test-org/repo:2025-01-01T12:00:00.000Z'
      const result = hmacHex(secret, payload)

      // Verify it's a valid hex string of correct length (64 chars for sha256)
      expect(result).toMatch(/^[a-f0-9]{64}$/)

      // Verify it produces consistent results
      const result2 = hmacHex(secret, payload)
      expect(result).toBe(result2)
    })

    it('should produce different signatures for different secrets', () => {
      const payload = 'test-org/repo:2025-01-01T12:00:00.000Z'
      const sig1 = hmacHex('secret1', payload)
      const sig2 = hmacHex('secret2', payload)

      expect(sig1).not.toBe(sig2)
    })

    it('should produce different signatures for different payloads', () => {
      const secret = 'test-secret'
      const sig1 = hmacHex(secret, 'test-org/repo1:2025-01-01T12:00:00.000Z')
      const sig2 = hmacHex(secret, 'test-org/repo2:2025-01-01T12:00:00.000Z')

      expect(sig1).not.toBe(sig2)
    })

    it('should produce known signature for test vector', () => {
      // Test with a known vector to ensure crypto is working correctly
      const secret = 'secret'
      const payload = 'test:2025-01-01T00:00:00.000Z'
      const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')

      expect(hmacHex(secret, payload)).toBe(expected)
    })
  })

  describe('withPrefix', () => {
    it('should add default sha256 prefix', () => {
      const sig = 'abc123def456'
      expect(withPrefix(sig)).toBe('sha256=abc123def456')
    })

    it('should add custom prefix', () => {
      const sig = 'abc123def456'
      expect(withPrefix(sig, 'custom=')).toBe('custom=abc123def456')
    })

    it('should handle empty prefix', () => {
      const sig = 'abc123def456'
      expect(withPrefix(sig, '')).toBe('abc123def456')
    })
  })

  describe('HMAC Integration', () => {
    it('should generate valid signature that can be verified', () => {
      const secret = 'integration-secret'
      const repo = 'test-org/test-repo'
      const timestamp = '2025-01-01T12:00:00.000Z'
      const payload = `${repo}:${timestamp}`

      // Generate signature
      const signature = hmacHex(secret, payload)
      const signatureWithPrefix = withPrefix(signature)

      // Verify signature
      const expectedSig = hmacHex(secret, payload)
      const providedSig = signatureWithPrefix.replace(/^sha256=/i, '')

      expect(expectedSig.toLowerCase()).toBe(providedSig.toLowerCase())
    })

    it('should detect wrong secret', () => {
      const repo = 'test-org/test-repo'
      const timestamp = '2025-01-01T12:00:00.000Z'
      const payload = `${repo}:${timestamp}`

      const correctSig = hmacHex('correct-secret', payload)
      const wrongSig = hmacHex('wrong-secret', payload)

      expect(correctSig).not.toBe(wrongSig)
    })

    it('should detect wrong timestamp', () => {
      const secret = 'test-secret'
      const repo = 'test-org/test-repo'

      const sig1 = hmacHex(secret, `${repo}:2025-01-01T12:00:00.000Z`)
      const sig2 = hmacHex(secret, `${repo}:2025-01-01T12:00:01.000Z`)

      expect(sig1).not.toBe(sig2)
    })

    it('should detect wrong repository', () => {
      const secret = 'test-secret'
      const timestamp = '2025-01-01T12:00:00.000Z'

      const sig1 = hmacHex(secret, `test-org/repo1:${timestamp}`)
      const sig2 = hmacHex(secret, `test-org/repo2:${timestamp}`)

      expect(sig1).not.toBe(sig2)
    })
  })

  describe('Timestamp offset scenarios', () => {
    const baseTime = '2025-12-05T10:00:00.000Z'

    it('should handle replay attack detection with old timestamp', () => {
      const secret = 'test-secret'
      const repo = 'test-org/test'

      // Signature from 10 minutes ago
      const oldTimestamp = applyOffset(baseTime, '-600s')
      const oldPayload = `${repo}:${oldTimestamp}`
      const oldSig = hmacHex(secret, oldPayload)

      // Current signature
      const currentPayload = `${repo}:${baseTime}`
      const currentSig = hmacHex(secret, currentPayload)

      // They should be different
      expect(oldSig).not.toBe(currentSig)
    })

    it('should handle clock skew tolerance window', () => {
      const secret = 'test-secret'
      const repo = 'test-org/test'

      // Within 5 minute window
      const timestamp1 = applyOffset(baseTime, '-299s') // -4m 59s
      const timestamp2 = applyOffset(baseTime, '+299s') // +4m 59s

      const sig1 = hmacHex(secret, `${repo}:${timestamp1}`)
      const sig2 = hmacHex(secret, `${repo}:${timestamp2}`)

      // Signatures should be different but both valid within window
      expect(sig1).not.toBe(sig2)
      expect(sig1).toMatch(/^[a-f0-9]{64}$/)
      expect(sig2).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  describe('formatOutput', () => {
    it('should format output data correctly', () => {
      const data: OutputData = {
        repo: 'test-org/test-repo',
        timestamp: '2025-12-07T12:00:00.000Z',
        signature: 'abc123def456',
        prefix: 'sha256=',
      }

      const result = formatOutput(data)

      expect(result).toContain('Repository: test-org/test-repo')
      expect(result).toContain('Timestamp: 2025-12-07T12:00:00.000Z')
      expect(result).toContain('Signature: sha256=abc123def456')
      expect(result).toContain('X-Hub-Repository: test-org/test-repo')
      expect(result).toContain('X-Hub-Timestamp: 2025-12-07T12:00:00.000Z')
      expect(result).toContain('X-Hub-Signature-256: sha256=abc123def456')
    })

    it('should handle empty prefix', () => {
      const data: OutputData = {
        repo: 'test-org/test-repo',
        timestamp: '2025-12-07T12:00:00.000Z',
        signature: 'abc123def456',
        prefix: '',
      }

      const result = formatOutput(data)

      expect(result).toContain('Signature: abc123def456')
      expect(result).toContain('X-Hub-Signature-256: abc123def456')
      expect(result).not.toContain('sha256=')
    })

    it('should handle custom prefix', () => {
      const data: OutputData = {
        repo: 'test-org/test-repo',
        timestamp: '2025-12-07T12:00:00.000Z',
        signature: 'abc123def456',
        prefix: 'custom=',
      }

      const result = formatOutput(data)

      expect(result).toContain('Signature: custom=abc123def456')
      expect(result).toContain('X-Hub-Signature-256: custom=abc123def456')
    })

    it('should return a string with newline separators', () => {
      const data: OutputData = {
        repo: 'test-org/test-repo',
        timestamp: '2025-12-07T12:00:00.000Z',
        signature: 'abc123def456',
        prefix: 'sha256=',
      }

      const result = formatOutput(data)
      const lines = result.split('\n')

      expect(lines.length).toBe(8)
      expect(lines[0]).toBe('Repository: test-org/test-repo')
      expect(lines[1]).toBe('Timestamp: 2025-12-07T12:00:00.000Z')
      expect(lines[2]).toBe('Signature: sha256=abc123def456')
      expect(lines[3]).toBe('')
      expect(lines[4]).toBe('Headers:')
      expect(lines[5]).toBe('  X-Hub-Repository: test-org/test-repo')
      expect(lines[6]).toBe('  X-Hub-Timestamp: 2025-12-07T12:00:00.000Z')
      expect(lines[7]).toBe('  X-Hub-Signature-256: sha256=abc123def456')
    })

    it('should format headers with correct indentation', () => {
      const data: OutputData = {
        repo: 'test-org/test',
        timestamp: '2025-01-01T00:00:00.000Z',
        signature: 'xyz789',
        prefix: 'sha256=',
      }

      const result = formatOutput(data)
      const lines = result.split('\n')

      // Check that header lines start with two spaces
      expect(lines[5].startsWith('  X-Hub-Repository:')).toBe(true)
      expect(lines[6].startsWith('  X-Hub-Timestamp:')).toBe(true)
      expect(lines[7].startsWith('  X-Hub-Signature-256:')).toBe(true)
    })

    it('should handle long repository names', () => {
      const data: OutputData = {
        repo: 'VeryLongOrganizationName/VeryLongRepositoryNameWithLotsOfCharacters',
        timestamp: '2025-12-07T12:00:00.000Z',
        signature: 'abc123',
        prefix: 'sha256=',
      }

      const result = formatOutput(data)

      expect(result).toContain('Repository: VeryLongOrganizationName/VeryLongRepositoryNameWithLotsOfCharacters')
      expect(result).toContain('X-Hub-Repository: VeryLongOrganizationName/VeryLongRepositoryNameWithLotsOfCharacters')
    })

    it('should handle long signatures', () => {
      const longSig = 'a'.repeat(64) // SHA-256 hex is 64 characters
      const data: OutputData = {
        repo: 'test-org/test',
        timestamp: '2025-12-07T12:00:00.000Z',
        signature: longSig,
        prefix: 'sha256=',
      }

      const result = formatOutput(data)

      expect(result).toContain(`Signature: sha256=${longSig}`)
      expect(result).toContain(`X-Hub-Signature-256: sha256=${longSig}`)
    })

    it('should handle uppercase signatures', () => {
      const data: OutputData = {
        repo: 'test-org/test',
        timestamp: '2025-12-07T12:00:00.000Z',
        signature: 'ABC123DEF456',
        prefix: 'sha256=',
      }

      const result = formatOutput(data)

      expect(result).toContain('Signature: sha256=ABC123DEF456')
      expect(result).toContain('X-Hub-Signature-256: sha256=ABC123DEF456')
    })

    it('should maintain exact output structure for CLI usage', () => {
      const data: OutputData = {
        repo: 'test-org/metrics',
        timestamp: '2025-12-07T15:30:45.000Z',
        signature: 'def456abc789',
        prefix: 'sha256=',
      }

      const result = formatOutput(data)
      const expected = [
        'Repository: test-org/metrics',
        'Timestamp: 2025-12-07T15:30:45.000Z',
        'Signature: sha256=def456abc789',
        '',
        'Headers:',
        '  X-Hub-Repository: test-org/metrics',
        '  X-Hub-Timestamp: 2025-12-07T15:30:45.000Z',
        '  X-Hub-Signature-256: sha256=def456abc789',
      ].join('\n')

      expect(result).toBe(expected)
    })

    it('should produce copyable headers output', () => {
      const data: OutputData = {
        repo: 'test-org/test',
        timestamp: '2025-12-07T12:00:00.000Z',
        signature: 'testSignature',
        prefix: 'sha256=',
      }

      const result = formatOutput(data)
      const lines = result.split('\n')

      // Extract just the header lines
      const headerLines = lines.slice(5)

      expect(headerLines[0]).toMatch(/^\s+X-Hub-Repository:/)
      expect(headerLines[1]).toMatch(/^\s+X-Hub-Timestamp:/)
      expect(headerLines[2]).toMatch(/^\s+X-Hub-Signature-256:/)
    })
  })

  describe('generateSignature', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-12-07T15:30:45.123Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should generate signature with default options', () => {
      const opts: GenerateOptions = {
        repo: 'test-org/test-repo',
        secret: 'test-secret',
      }

      const result = generateSignature(opts)

      expect(result.repo).toBe('test-org/test-repo')
      expect(result.timestamp).toBe('2025-12-07T15:30:45.000Z')
      expect(result.signature).toMatch(/^[a-f0-9]{64}$/)
      expect(result.prefix).toBe('sha256=')
    })

    it('should use provided timestamp', () => {
      const opts: GenerateOptions = {
        repo: 'test-org/test-repo',
        secret: 'test-secret',
        timestamp: '2025-01-01T00:00:00.000Z',
      }

      const result = generateSignature(opts)

      expect(result.timestamp).toBe('2025-01-01T00:00:00.000Z')
    })

    it('should apply offset to timestamp', () => {
      const opts: GenerateOptions = {
        repo: 'test-org/test-repo',
        secret: 'test-secret',
        timestamp: '2025-12-07T12:00:00.000Z',
        offset: '-300s',
      }

      const result = generateSignature(opts)

      expect(result.timestamp).toBe('2025-12-07T11:55:00.000Z')
    })

    it('should uppercase signature when requested', () => {
      const opts: GenerateOptions = {
        repo: 'test-org/test-repo',
        secret: 'test-secret',
        upper: true,
      }

      const result = generateSignature(opts)

      expect(result.signature).toMatch(/^[A-F0-9]{64}$/)
      expect(result.signature).toBe(result.signature.toUpperCase())
    })

    it('should use custom prefix', () => {
      const opts: GenerateOptions = {
        repo: 'test-org/test-repo',
        secret: 'test-secret',
        prefix: 'custom=',
      }

      const result = generateSignature(opts)

      expect(result.prefix).toBe('custom=')
    })

    it('should generate consistent signature for same inputs', () => {
      const opts: GenerateOptions = {
        repo: 'test-org/test-repo',
        secret: 'test-secret',
        timestamp: '2025-12-07T12:00:00.000Z',
      }

      const result1 = generateSignature(opts)
      const result2 = generateSignature(opts)

      expect(result1.signature).toBe(result2.signature)
    })

    it('should generate different signatures for different repos', () => {
      const opts1: GenerateOptions = {
        repo: 'test-org/repo1',
        secret: 'test-secret',
        timestamp: '2025-12-07T12:00:00.000Z',
      }
      const opts2: GenerateOptions = {
        repo: 'test-org/repo2',
        secret: 'test-secret',
        timestamp: '2025-12-07T12:00:00.000Z',
      }

      const result1 = generateSignature(opts1)
      const result2 = generateSignature(opts2)

      expect(result1.signature).not.toBe(result2.signature)
    })
  })

  describe('verifySignature', () => {
    it('should verify matching signature', () => {
      const secret = 'test-secret'
      const repo = 'test-org/test-repo'
      const timestamp = '2025-12-07T12:00:00.000Z'
      const payload = `${repo}:${timestamp}`
        const signature = `sha256=${hmacHex(secret, payload)}`

      const result = verifySignature({ repo, secret, timestamp, signature })

      expect(result.match).toBe(true)
      expect(result.expected).toBe(result.provided)
    })

    it('should detect non-matching signature', () => {
      const opts: VerifyOptions = {
        repo: 'test-org/test-repo',
        secret: 'test-secret',
        timestamp: '2025-12-07T12:00:00.000Z',
        signature: 'sha256=wrong1234567890abcdef',
      }

      const result = verifySignature(opts)

      expect(result.match).toBe(false)
      expect(result.expected).not.toBe(result.provided)
    })

    it('should handle signature without prefix', () => {
      const secret = 'test-secret'
      const repo = 'test-org/test-repo'
      const timestamp = '2025-12-07T12:00:00.000Z'
      const payload = `${repo}:${timestamp}`
      const signature = hmacHex(secret, payload)

      const result = verifySignature({ repo, secret, timestamp, signature })

      expect(result.match).toBe(true)
    })

    it('should be case-insensitive for hex comparison', () => {
      const secret = 'test-secret'
      const repo = 'test-org/test-repo'
      const timestamp = '2025-12-07T12:00:00.000Z'
      const payload = `${repo}:${timestamp}`
      const sigHex = hmacHex(secret, payload)
      const signature = `sha256=${sigHex.toUpperCase()}`

      const result = verifySignature({ repo, secret, timestamp, signature })

      expect(result.match).toBe(true)
    })

    it('should detect wrong secret', () => {
      const repo = 'test-org/test-repo'
      const timestamp = '2025-12-07T12:00:00.000Z'
      const correctPayload = `${repo}:${timestamp}`
      const correctSig = `sha256=${hmacHex('correct-secret', correctPayload)}`

      const result = verifySignature({
        repo,
        secret: 'wrong-secret',
        timestamp,
        signature: correctSig,
      })

      expect(result.match).toBe(false)
    })
  })

  describe('generateInvalidSignature', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-12-07T15:30:45.123Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    describe('wrong-secret kind', () => {
      it('should generate signature with wrong secret by appending _wrong', () => {
        const opts: InvalidOptions = {
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          kind: 'wrong-secret',
          timestamp: '2025-12-07T12:00:00.000Z',
        }

        const result = generateInvalidSignature(opts)

        // Verify it uses secret + '_wrong'
        const wrongPayload = `${opts.repo}:${result.timestamp}`
        const expectedSig = hmacHex('test-secret_wrong', wrongPayload)
        expect(result.signature).toBe(expectedSig)

        // Verify it's different from correct signature
        const correctSig = hmacHex(opts.secret, wrongPayload)
        expect(result.signature).not.toBe(correctSig)
        expect(result.signature).toMatch(/^[a-f0-9]{64}$/)
        expect(result.prefix).toBe('sha256=')
      })

      it('should use "wrong" as secret when no secret provided', () => {
        const opts: InvalidOptions = {
          repo: 'test-org/test-repo',
          secret: '',
          kind: 'wrong-secret',
          timestamp: '2025-12-07T12:00:00.000Z',
        }

        const result = generateInvalidSignature(opts)
        const payload = `${opts.repo}:${result.timestamp}`
        const expectedSig = hmacHex('wrong', payload)

        expect(result.signature).toBe(expectedSig)
      })

      it('should return all fields correctly for wrong-secret', () => {
        const opts: InvalidOptions = {
          repo: 'test-org/test-repo',
          secret: 'my-secret',
          kind: 'wrong-secret',
          timestamp: '2025-12-07T12:00:00.000Z',
        }

        const result = generateInvalidSignature(opts)

        expect(result.repo).toBe('test-org/test-repo')
        expect(result.timestamp).toBe('2025-12-07T12:00:00.000Z')
        expect(result.prefix).toBe('sha256=')
        expect(result.signature).toMatch(/^[a-f0-9]{64}$/)
      })
    })

    describe('wrong-repo kind', () => {
      it('should generate signature with WRONG/ prepended to repo', () => {
        const opts: InvalidOptions = {
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          kind: 'wrong-repo',
          timestamp: '2025-12-07T12:00:00.000Z',
        }

        const result = generateInvalidSignature(opts)

        // Verify it uses WRONG/repo in payload
        const wrongPayload = `WRONG/${opts.repo}:${result.timestamp}`
        const expectedSig = hmacHex(opts.secret, wrongPayload)
        expect(result.signature).toBe(expectedSig)

        // Verify it's different from correct signature
        const correctPayload = `${opts.repo}:${result.timestamp}`
        const correctSig = hmacHex(opts.secret, correctPayload)
        expect(result.signature).not.toBe(correctSig)
      })

      it('should use "secret" as fallback when no secret provided for wrong-repo', () => {
        const opts: InvalidOptions = {
          repo: 'test-org/test-repo',
          secret: '',
          kind: 'wrong-repo',
          timestamp: '2025-12-07T12:00:00.000Z',
        }

        const result = generateInvalidSignature(opts)
        const wrongPayload = `WRONG/${opts.repo}:${result.timestamp}`
        const expectedSig = hmacHex('secret', wrongPayload)

        expect(result.signature).toBe(expectedSig)
      })

      it('should return original repo in result, not WRONG/repo', () => {
        const opts: InvalidOptions = {
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          kind: 'wrong-repo',
          timestamp: '2025-12-07T12:00:00.000Z',
        }

        const result = generateInvalidSignature(opts)

        // Result should contain original repo, not the modified one used for signature
        expect(result.repo).toBe('test-org/test-repo')
        expect(result.repo).not.toContain('WRONG/')
      })
    })

    describe('wrong-timestamp kind', () => {
      it('should generate signature using hardcoded 1999 timestamp', () => {
        const opts: InvalidOptions = {
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          kind: 'wrong-timestamp',
          timestamp: '2025-12-07T12:00:00.000Z',
        }

        const result = generateInvalidSignature(opts)

        // Verify it uses 1999-01-01 in signature calculation
        const wrongPayload = `${opts.repo}:1999-01-01T00:00:00.000Z`
        const expectedSig = hmacHex(opts.secret, wrongPayload)
        expect(result.signature).toBe(expectedSig)

        // Verify it's different from correct signature
        const correctPayload = `${opts.repo}:${result.timestamp}`
        const correctSig = hmacHex(opts.secret, correctPayload)
        expect(result.signature).not.toBe(correctSig)
      })

      it('should return provided timestamp in result, not 1999', () => {
        const opts: InvalidOptions = {
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          kind: 'wrong-timestamp',
          timestamp: '2025-12-07T12:00:00.000Z',
        }

        const result = generateInvalidSignature(opts)

        // Result should contain the provided timestamp, not the one used for signature
        expect(result.timestamp).toBe('2025-12-07T12:00:00.000Z')
        expect(result.timestamp).not.toBe('1999-01-01T00:00:00.000Z')
      })

      it('should use "secret" as fallback when no secret provided for wrong-timestamp', () => {
        const opts: InvalidOptions = {
          repo: 'test-org/test-repo',
          secret: '',
          kind: 'wrong-timestamp',
          timestamp: '2025-12-07T12:00:00.000Z',
        }

        const result = generateInvalidSignature(opts)
        const wrongPayload = `${opts.repo}:1999-01-01T00:00:00.000Z`
        const expectedSig = hmacHex('secret', wrongPayload)

        expect(result.signature).toBe(expectedSig)
      })
    })

    describe('uppercase kind', () => {
      it('should generate uppercase signature with correct payload', () => {
        const opts: InvalidOptions = {
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          kind: 'uppercase',
          timestamp: '2025-12-07T12:00:00.000Z',
        }

        const result = generateInvalidSignature(opts)

        // Verify it's the correct signature but uppercased
        const correctPayload = `${opts.repo}:${result.timestamp}`
        const lowercaseSig = hmacHex(opts.secret, correctPayload)
        expect(result.signature).toBe(lowercaseSig.toUpperCase())

        expect(result.signature).toMatch(/^[A-F0-9]{64}$/)
        expect(result.signature).toBe(result.signature.toUpperCase())
      })

      it('should use "secret" as fallback when no secret provided for uppercase', () => {
        const opts: InvalidOptions = {
          repo: 'test-org/test-repo',
          secret: '',
          kind: 'uppercase',
          timestamp: '2025-12-07T12:00:00.000Z',
        }

        const result = generateInvalidSignature(opts)
        const payload = `${opts.repo}:${result.timestamp}`
        const expectedSig = hmacHex('secret', payload).toUpperCase()

        expect(result.signature).toBe(expectedSig)
      })

      it('should maintain sha256= prefix for uppercase', () => {
        const opts: InvalidOptions = {
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          kind: 'uppercase',
          timestamp: '2025-12-07T12:00:00.000Z',
        }

        const result = generateInvalidSignature(opts)

        expect(result.prefix).toBe('sha256=')
      })
    })

    describe('no-prefix kind', () => {
      it('should generate signature with empty prefix', () => {
        const opts: InvalidOptions = {
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          kind: 'no-prefix',
          timestamp: '2025-12-07T12:00:00.000Z',
        }

        const result = generateInvalidSignature(opts)

        expect(result.prefix).toBe('')

        // Signature should still be valid, just without prefix
        const correctPayload = `${opts.repo}:${result.timestamp}`
        const expectedSig = hmacHex(opts.secret, correctPayload)
        expect(result.signature).toBe(expectedSig)
      })

      it('should use "secret" as fallback when no secret provided for no-prefix', () => {
        const opts: InvalidOptions = {
          repo: 'test-org/test-repo',
          secret: '',
          kind: 'no-prefix',
          timestamp: '2025-12-07T12:00:00.000Z',
        }

        const result = generateInvalidSignature(opts)
        const payload = `${opts.repo}:${result.timestamp}`
        const expectedSig = hmacHex('secret', payload)

        expect(result.signature).toBe(expectedSig)
        expect(result.prefix).toBe('')
      })

      it('should override custom prefix when kind is no-prefix', () => {
        const opts: InvalidOptions = {
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          kind: 'no-prefix',
          timestamp: '2025-12-07T12:00:00.000Z',
          prefix: 'custom=', // This should be overridden
        }

        const result = generateInvalidSignature(opts)

        expect(result.prefix).toBe('')
      })
    })

    describe('default behavior', () => {
      it('should default to wrong-secret kind when kind not specified', () => {
        const opts: InvalidOptions = {
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          timestamp: '2025-12-07T12:00:00.000Z',
        }

        const result = generateInvalidSignature(opts)

        // Should behave same as wrong-secret
        const wrongPayload = `${opts.repo}:${result.timestamp}`
        const expectedSig = hmacHex('test-secret_wrong', wrongPayload)
        expect(result.signature).toBe(expectedSig)
        expect(result.signature).toMatch(/^[a-f0-9]{64}$/)
      })
    })

    describe('common functionality across all kinds', () => {
      it('should apply offset to timestamp for all kinds', () => {
        const kinds: Array<'wrong-secret' | 'wrong-repo' | 'wrong-timestamp' | 'uppercase' | 'no-prefix'> = [
          'wrong-secret',
          'wrong-repo',
          'wrong-timestamp',
          'uppercase',
          'no-prefix',
        ]

        kinds.forEach(kind => {
          const opts: InvalidOptions = {
            repo: 'test-org/test-repo',
            secret: 'test-secret',
            kind,
            timestamp: '2025-12-07T12:00:00.000Z',
            offset: '-600s',
          }

          const result = generateInvalidSignature(opts)

          expect(result.timestamp).toBe('2025-12-07T11:50:00.000Z')
        })
      })

      it('should use current time when no timestamp provided for all kinds', () => {
        const kinds: Array<'wrong-secret' | 'wrong-repo' | 'wrong-timestamp' | 'uppercase' | 'no-prefix'> = [
          'wrong-secret',
          'wrong-repo',
          'wrong-timestamp',
          'uppercase',
          'no-prefix',
        ]

        kinds.forEach(kind => {
          const opts: InvalidOptions = {
            repo: 'test-org/test-repo',
            secret: 'test-secret',
            kind,
          }

          const result = generateInvalidSignature(opts)

          expect(result.timestamp).toBe('2025-12-07T15:30:45.000Z')
        })
      })

      it('should respect custom prefix for all kinds except no-prefix', () => {
        const kindsWithPrefix: Array<'wrong-secret' | 'wrong-repo' | 'wrong-timestamp' | 'uppercase'> = [
          'wrong-secret',
          'wrong-repo',
          'wrong-timestamp',
          'uppercase',
        ]

        kindsWithPrefix.forEach(kind => {
          const opts: InvalidOptions = {
            repo: 'test-org/test-repo',
            secret: 'test-secret',
            kind,
            timestamp: '2025-12-07T12:00:00.000Z',
            prefix: 'custom=',
          }

          const result = generateInvalidSignature(opts)

          expect(result.prefix).toBe('custom=')
        })
      })

      it('should always return valid OutputData structure', () => {
        const kinds: Array<'wrong-secret' | 'wrong-repo' | 'wrong-timestamp' | 'uppercase' | 'no-prefix'> = [
          'wrong-secret',
          'wrong-repo',
          'wrong-timestamp',
          'uppercase',
          'no-prefix',
        ]

        kinds.forEach(kind => {
          const opts: InvalidOptions = {
            repo: 'test-org/test-repo',
            secret: 'test-secret',
            kind,
            timestamp: '2025-12-07T12:00:00.000Z',
          }

          const result = generateInvalidSignature(opts)

          expect(result).toHaveProperty('repo')
          expect(result).toHaveProperty('timestamp')
          expect(result).toHaveProperty('signature')
          expect(result).toHaveProperty('prefix')
          expect(typeof result.repo).toBe('string')
          expect(typeof result.timestamp).toBe('string')
          expect(typeof result.signature).toBe('string')
          expect(typeof result.prefix).toBe('string')
        })
      })
    })

    describe('error handling', () => {
      it('should throw error for invalid kind', () => {
        const opts = {
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          kind: 'invalid-kind' as any,
          timestamp: '2025-12-07T12:00:00.000Z',
        }

        expect(() => generateInvalidSignature(opts)).toThrow('Invalid kind')
        expect(() => generateInvalidSignature(opts)).toThrow('Use one of: wrong-secret, wrong-repo, wrong-timestamp, uppercase, no-prefix')
      })

      it('should throw error with specific kind name in message', () => {
        const opts = {
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          kind: 'bad-value' as any,
          timestamp: '2025-12-07T12:00:00.000Z',
        }

        expect(() => generateInvalidSignature(opts)).toThrow('Invalid kind: bad-value')
      })
    })
  })

  describe('validateRequiredOptions', () => {
    it('should return error when repo is missing', () => {
      const result = validateRequiredOptions('', 'secret', 'generate')

      expect(result).not.toBeNull()
      expect(result?.error).toBe('Missing --repo')
    })

    it('should return error when secret is missing for generate mode', () => {
      const result = validateRequiredOptions('test-org/test', '', 'generate')

      expect(result).not.toBeNull()
      expect(result?.error).toBe('Missing --secret')
    })

    it('should return error when secret is missing for verify mode', () => {
      const result = validateRequiredOptions('test-org/test', '', 'verify')

      expect(result).not.toBeNull()
      expect(result?.error).toBe('Missing --secret')
    })

    it('should return null when secret is missing for invalid mode', () => {
      const result = validateRequiredOptions('test-org/test', '', 'invalid')

      expect(result).toBeNull()
    })

    it('should return null when all required options are provided for generate', () => {
      const result = validateRequiredOptions('test-org/test', 'secret', 'generate')

      expect(result).toBeNull()
    })

    it('should return null when all required options are provided for verify', () => {
      const result = validateRequiredOptions('test-org/test', 'secret', 'verify')

      expect(result).toBeNull()
    })

    it('should return null when all required options are provided for invalid', () => {
      const result = validateRequiredOptions('test-org/test', 'secret', 'invalid')

      expect(result).toBeNull()
    })

    it('should prioritize repo error over secret error', () => {
      const result = validateRequiredOptions('', '', 'generate')

      expect(result).not.toBeNull()
      expect(result?.error).toBe('Missing --repo')
    })
  })

  describe('handleGenerate', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-12-07T15:30:45.123Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should call generateSignature with correct options', () => {
      const opts: GenerateHandlerOptions = {
        repo: 'test-org/test-repo',
        secret: 'test-secret',
        timestamp: '2025-12-07T12:00:00.000Z',
        offset: '-300s',
        prefix: 'sha256=',
        upper: false,
      }

      const result = handleGenerate(opts)

      expect(result.repo).toBe('test-org/test-repo')
      expect(result.timestamp).toBe('2025-12-07T11:55:00.000Z')
      expect(result.signature).toMatch(/^[a-f0-9]{64}$/)
      expect(result.prefix).toBe('sha256=')
    })

    it('should handle uppercase flag', () => {
      const opts: GenerateHandlerOptions = {
        repo: 'test-org/test-repo',
        secret: 'test-secret',
        prefix: 'sha256=',
        upper: true,
      }

      const result = handleGenerate(opts)

      expect(result.signature).toMatch(/^[A-F0-9]{64}$/)
    })

    it('should handle custom prefix', () => {
      const opts: GenerateHandlerOptions = {
        repo: 'test-org/test-repo',
        secret: 'test-secret',
        prefix: 'custom=',
        upper: false,
      }

      const result = handleGenerate(opts)

      expect(result.prefix).toBe('custom=')
    })

    it('should use current time when no timestamp provided', () => {
      const opts: GenerateHandlerOptions = {
        repo: 'test-org/test-repo',
        secret: 'test-secret',
        prefix: 'sha256=',
        upper: false,
      }

      const result = handleGenerate(opts)

      expect(result.timestamp).toBe('2025-12-07T15:30:45.000Z')
    })
  })

  describe('handleVerify', () => {
    it('should verify matching signature and return success', () => {
      const secret = 'test-secret'
      const repo = 'test-org/test-repo'
      const timestamp = '2025-12-07T12:00:00.000Z'
      const payload = `${repo}:${timestamp}`
      const signature = `sha256=${hmacHex(secret, payload)}`

      const result = handleVerify({
        repo,
        secret,
        timestamp,
        signature,
      })

      expect(result.result.match).toBe(true)
      expect(result.output).toEqual(['Match: true'])
      expect(result.exitCode).toBe(0)
    })

    it('should verify non-matching signature and return failure with details', () => {
      const secret = 'test-secret'
      const repo = 'test-org/test-repo'
      const timestamp = '2025-12-07T12:00:00.000Z'
      const wrongSignature = 'sha256=wrongsignature123'

      const result = handleVerify({
        repo,
        secret,
        timestamp,
        signature: wrongSignature,
      })

      expect(result.result.match).toBe(false)
      expect(result.output.length).toBe(3)
      expect(result.output[0]).toBe('Match: false')
      expect(result.output[1]).toContain('Expected: sha256=')
      expect(result.output[2]).toContain('Provided: sha256=')
      expect(result.exitCode).toBe(2)
    })

    it('should throw error when timestamp is missing', () => {
      expect(() =>
        handleVerify({
          repo: 'test-org/test',
          secret: 'secret',
          timestamp: '',
          signature: 'sha256=abc',
        })
      ).toThrow('Missing --timestamp and/or --signature')
    })

    it('should throw error when signature is missing', () => {
      expect(() =>
        handleVerify({
          repo: 'test-org/test',
          secret: 'secret',
          timestamp: '2025-12-07T12:00:00.000Z',
          signature: '',
        })
      ).toThrow('Missing --timestamp and/or --signature')
    })

    it('should throw error when both timestamp and signature are missing', () => {
      expect(() =>
        handleVerify({
          repo: 'test-org/test',
          secret: 'secret',
          timestamp: '',
          signature: '',
        })
      ).toThrow('Missing --timestamp and/or --signature')
    })

    it('should return exit code 2 for non-matching signature', () => {
      const result = handleVerify({
        repo: 'test-org/test',
        secret: 'secret',
        timestamp: '2025-12-07T12:00:00.000Z',
        signature: 'sha256=wrong',
      })

      expect(result.exitCode).toBe(2)
    })

    it('should include expected and provided signatures in output when match fails', () => {
      const secret = 'test-secret'
      const repo = 'test-org/test'
      const timestamp = '2025-12-07T12:00:00.000Z'
      const payload = `${repo}:${timestamp}`
      const expectedSig = hmacHex(secret, payload)

      const result = handleVerify({
        repo,
        secret,
        timestamp,
        signature: 'sha256=wrongsig',
      })

      expect(result.output[1]).toBe(`Expected: sha256=${expectedSig}`)
      expect(result.output[2]).toBe('Provided: sha256=wrongsig')
    })
  })

  describe('handleInvalid', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-12-07T15:30:45.123Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should call generateInvalidSignature with correct options for wrong-secret', () => {
      const opts: InvalidHandlerOptions = {
        repo: 'test-org/test-repo',
        secret: 'test-secret',
        kind: 'wrong-secret',
        timestamp: '2025-12-07T12:00:00.000Z',
        prefix: 'sha256=',
      }

      const result = handleInvalid(opts)

      expect(result.repo).toBe('test-org/test-repo')
      expect(result.timestamp).toBe('2025-12-07T12:00:00.000Z')
      expect(result.signature).toMatch(/^[a-f0-9]{64}$/)
      expect(result.prefix).toBe('sha256=')
    })

    it('should handle all invalid kinds', () => {
      const kinds: Array<'wrong-secret' | 'wrong-repo' | 'wrong-timestamp' | 'uppercase' | 'no-prefix'> = [
        'wrong-secret',
        'wrong-repo',
        'wrong-timestamp',
        'uppercase',
        'no-prefix',
      ]

      kinds.forEach(kind => {
        const opts: InvalidHandlerOptions = {
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          kind,
          timestamp: '2025-12-07T12:00:00.000Z',
          prefix: 'sha256=',
        }

        const result = handleInvalid(opts)

        expect(result).toHaveProperty('repo')
        expect(result).toHaveProperty('timestamp')
        expect(result).toHaveProperty('signature')
        expect(result).toHaveProperty('prefix')
      })
    })

    it('should apply offset when provided', () => {
      const opts: InvalidHandlerOptions = {
        repo: 'test-org/test-repo',
        secret: 'test-secret',
        kind: 'wrong-secret',
        timestamp: '2025-12-07T12:00:00.000Z',
        offset: '-600s',
        prefix: 'sha256=',
      }

      const result = handleInvalid(opts)

      expect(result.timestamp).toBe('2025-12-07T11:50:00.000Z')
    })

    it('should use current time when no timestamp provided', () => {
      const opts: InvalidHandlerOptions = {
        repo: 'test-org/test-repo',
        secret: 'test-secret',
        kind: 'wrong-secret',
        prefix: 'sha256=',
      }

      const result = handleInvalid(opts)

      expect(result.timestamp).toBe('2025-12-07T15:30:45.000Z')
    })

    it('should handle custom prefix', () => {
      const opts: InvalidHandlerOptions = {
        repo: 'test-org/test-repo',
        secret: 'test-secret',
        kind: 'wrong-secret',
        timestamp: '2025-12-07T12:00:00.000Z',
        prefix: 'custom=',
      }

      const result = handleInvalid(opts)

      expect(result.prefix).toBe('custom=')
    })

    it('should override prefix for no-prefix kind', () => {
      const opts: InvalidHandlerOptions = {
        repo: 'test-org/test-repo',
        secret: 'test-secret',
        kind: 'no-prefix',
        timestamp: '2025-12-07T12:00:00.000Z',
        prefix: 'sha256=',
      }

      const result = handleInvalid(opts)

      expect(result.prefix).toBe('')
    })
  })

  describe('executeCommand', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-12-07T15:30:45.123Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    describe('generate mode', () => {
      it('should execute generate command successfully', async () => {
        const options: ExecuteCommandOptions = {
          mode: 'generate',
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          prefix: 'sha256=',
          upper: false,
          opts: {
            timestamp: '2025-12-07T12:00:00.000Z',
          },
        }

        const result = await executeCommand(options)

        expect(result.exitCode).toBe(0)
        expect(result.output.length).toBe(1)
        expect(result.output[0]).toContain('Repository: test-org/test-repo')
        expect(result.output[0]).toContain('Timestamp: 2025-12-07T12:00:00.000Z')
        expect(result.output[0]).toContain('X-Hub-Signature-256: sha256=')
      })

      it('should handle uppercase flag in generate mode', async () => {
        const options: ExecuteCommandOptions = {
          mode: 'generate',
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          prefix: 'sha256=',
          upper: true,
          opts: {
            timestamp: '2025-12-07T12:00:00.000Z',
          },
        }

        const result = await executeCommand(options)

        expect(result.exitCode).toBe(0)
        expect(result.output[0]).toMatch(/Signature: sha256=[A-F0-9]{64}/)
      })

      it('should apply offset in generate mode', async () => {
        const options: ExecuteCommandOptions = {
          mode: 'generate',
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          prefix: 'sha256=',
          upper: false,
          opts: {
            timestamp: '2025-12-07T12:00:00.000Z',
            offset: '-300s',
          },
        }

        const result = await executeCommand(options)

        expect(result.exitCode).toBe(0)
        expect(result.output[0]).toContain('Timestamp: 2025-12-07T11:55:00.000Z')
      })

      it('should use current time when no timestamp provided in generate mode', async () => {
        const options: ExecuteCommandOptions = {
          mode: 'generate',
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          prefix: 'sha256=',
          upper: false,
          opts: {},
        }

        const result = await executeCommand(options)

        expect(result.exitCode).toBe(0)
        expect(result.output[0]).toContain('Timestamp: 2025-12-07T15:30:45.000Z')
      })
    })

    describe('verify mode', () => {
      it('should execute verify command with matching signature', async () => {
        const secret = 'test-secret'
        const repo = 'test-org/test-repo'
        const timestamp = '2025-12-07T12:00:00.000Z'
        const payload = `${repo}:${timestamp}`
        const signature = `sha256=${hmacHex(secret, payload)}`

        const options: ExecuteCommandOptions = {
          mode: 'verify',
          repo,
          secret,
          prefix: 'sha256=',
          upper: false,
          opts: {
            timestamp,
            signature,
          },
        }

        const result = await executeCommand(options)

        expect(result.exitCode).toBe(0)
        expect(result.output).toEqual(['Match: true'])
      })

      it('should execute verify command with non-matching signature', async () => {
        const options: ExecuteCommandOptions = {
          mode: 'verify',
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          prefix: 'sha256=',
          upper: false,
          opts: {
            timestamp: '2025-12-07T12:00:00.000Z',
            signature: 'sha256=wrongsignature',
          },
        }

        const result = await executeCommand(options)

        expect(result.exitCode).toBe(2)
        expect(result.output.length).toBe(3)
        expect(result.output[0]).toBe('Match: false')
        expect(result.output[1]).toContain('Expected: sha256=')
        expect(result.output[2]).toContain('Provided: sha256=')
      })

      it('should handle missing timestamp in verify mode', async () => {
        const options: ExecuteCommandOptions = {
          mode: 'verify',
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          prefix: 'sha256=',
          upper: false,
          opts: {
            signature: 'sha256=test',
          },
        }

        const result = await executeCommand(options)

        expect(result.exitCode).toBe(1)
        expect(result.output[0]).toContain('Missing --timestamp and/or --signature')
      })

      it('should handle missing signature in verify mode', async () => {
        const options: ExecuteCommandOptions = {
          mode: 'verify',
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          prefix: 'sha256=',
          upper: false,
          opts: {
            timestamp: '2025-12-07T12:00:00.000Z',
          },
        }

        const result = await executeCommand(options)

        expect(result.exitCode).toBe(1)
        expect(result.output[0]).toContain('Missing --timestamp and/or --signature')
      })
    })

    describe('invalid mode', () => {
      it('should execute invalid command with wrong-secret kind', async () => {
        const options: ExecuteCommandOptions = {
          mode: 'invalid',
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          prefix: 'sha256=',
          upper: false,
          opts: {
            kind: 'wrong-secret',
            timestamp: '2025-12-07T12:00:00.000Z',
          },
        }

        const result = await executeCommand(options)

        expect(result.exitCode).toBe(0)
        expect(result.output.length).toBe(1)
        expect(result.output[0]).toContain('Repository: test-org/test-repo')
        expect(result.output[0]).toContain('Timestamp: 2025-12-07T12:00:00.000Z')
      })

      it('should execute invalid command with all kinds', async () => {
        const kinds = ['wrong-secret', 'wrong-repo', 'wrong-timestamp', 'uppercase', 'no-prefix']

        for (const kind of kinds) {
          const options: ExecuteCommandOptions = {
            mode: 'invalid',
            repo: 'test-org/test-repo',
            secret: 'test-secret',
            prefix: 'sha256=',
            upper: false,
            opts: {
              kind,
              timestamp: '2025-12-07T12:00:00.000Z',
            },
          }

          const result = await executeCommand(options)

          expect(result.exitCode).toBe(0)
          expect(result.output.length).toBe(1)
        }
      })

      it('should handle invalid kind in invalid mode', async () => {
        const options: ExecuteCommandOptions = {
          mode: 'invalid',
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          prefix: 'sha256=',
          upper: false,
          opts: {
            kind: 'bad-kind',
            timestamp: '2025-12-07T12:00:00.000Z',
          },
        }

        const result = await executeCommand(options)

        expect(result.exitCode).toBe(1)
        expect(result.output[0]).toContain('Invalid kind')
      })

      it('should default to wrong-secret when kind not provided', async () => {
        const options: ExecuteCommandOptions = {
          mode: 'invalid',
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          prefix: 'sha256=',
          upper: false,
          opts: {
            timestamp: '2025-12-07T12:00:00.000Z',
          },
        }

        const result = await executeCommand(options)

        expect(result.exitCode).toBe(0)
        expect(result.output.length).toBe(1)
      })
    })

    describe('request mode', () => {
      let server: http.Server
      let endpointUrl: string
      let lastHeaders: http.IncomingHttpHeaders | undefined
      let lastBody: string
      let nextStatus = 200
      let nextResponseBody: Record<string, unknown> = { ok: true }

      beforeAll(async () => {
        await new Promise<void>(resolve => {
          server = http.createServer((req, res) => {
            lastHeaders = req.headers
            const chunks: Buffer[] = []
            req.on('data', chunk => chunks.push(Buffer.from(chunk)))
            req.on('end', () => {
              lastBody = Buffer.concat(chunks).toString('utf8')
              res.writeHead(nextStatus, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify(nextResponseBody))
            })
          })

          server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            if (typeof address === 'object' && address) {
              endpointUrl = `http://127.0.0.1:${address.port}/test`
            } else {
              throw new Error('Failed to obtain server address')
            }
            resolve()
          })
        })
      })

      afterAll(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()))
      })

      beforeEach(() => {
        nextStatus = 200
        nextResponseBody = { ok: true }
        lastBody = ''
        lastHeaders = undefined
      })

      it('should send signed request and succeed on 200 response', async () => {
        const options: ExecuteCommandOptions = {
          mode: 'request',
          repo: 'test-org/test-repo',
          secret: 'top-secret',
          prefix: 'sha256=',
          upper: false,
          opts: {
            endpoint: endpointUrl,
            action: 'check',
          },
        }

        const result = await executeCommand(options)

        expect(result.exitCode).toBe(0)
        expect(result.output.some(line => line.includes('Status: 200'))).toBe(true)
        expect(lastHeaders?.['x-hub-repository']).toBe('test-org/test-repo')
        expect(lastHeaders?.['x-hub-signature-256']).toMatch(/^sha256=/)
        expect(JSON.parse(lastBody)).toEqual({ action: 'check' })
      })

      it('should surface non-2xx responses as failures', async () => {
        nextStatus = 403
        nextResponseBody = { error: 'forbidden' }

        const options: ExecuteCommandOptions = {
          mode: 'request',
          repo: 'test-org/test-repo',
          secret: 'top-secret',
          prefix: 'sha256=',
          upper: false,
          opts: {
            endpoint: endpointUrl,
          },
        }

        const result = await executeCommand(options)

        expect(result.exitCode).toBe(2)
        expect(result.output.some(line => line.includes('Status: 403'))).toBe(true)
      })

      it('should accept custom body payloads', async () => {
        const customBody = { action: 'check', context: { mode: 'report' } }
        const options: ExecuteCommandOptions = {
          mode: 'request',
          repo: 'test-org/test-repo',
          secret: 'top-secret',
          prefix: 'sha256=',
          upper: false,
          opts: {
            endpoint: endpointUrl,
            body: JSON.stringify(customBody),
          },
        }

        const result = await executeCommand(options)

        expect(result.exitCode).toBe(0)
        expect(JSON.parse(lastBody)).toEqual(customBody)
      })

      it('should validate JSON context before sending', async () => {
        const options: ExecuteCommandOptions = {
          mode: 'request',
          repo: 'test-org/test-repo',
          secret: 'top-secret',
          prefix: 'sha256=',
          upper: false,
          opts: {
            endpoint: endpointUrl,
            context: '{invalid',
          },
        }

        const result = await executeCommand(options)

        expect(result.exitCode).toBe(1)
        expect(result.output[0]).toContain('--context must be valid JSON')
      })
    })

    describe('default/unknown mode', () => {
      it('should return usage message for unknown mode', async () => {
        const options: ExecuteCommandOptions = {
          mode: 'unknown' as any,
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          prefix: 'sha256=',
          upper: false,
          opts: {},
        }

        const result = await executeCommand(options)

        expect(result.exitCode).toBe(1)
        expect(result.output[0]).toContain('Usage: hmac-helper')
        expect(result.output[0]).toContain('<generate|verify|invalid|request>')
      })
    })

    describe('edge cases', () => {
      it('should handle empty options object', async () => {
        const options: ExecuteCommandOptions = {
          mode: 'generate',
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          prefix: 'sha256=',
          upper: false,
          opts: {},
        }

        const result = await executeCommand(options)

        expect(result.exitCode).toBe(0)
        expect(result.output.length).toBe(1)
      })

      it('should handle custom prefix', async () => {
        const options: ExecuteCommandOptions = {
          mode: 'generate',
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          prefix: 'custom=',
          upper: false,
          opts: {
            timestamp: '2025-12-07T12:00:00.000Z',
          },
        }

        const result = await executeCommand(options)

        expect(result.exitCode).toBe(0)
        expect(result.output[0]).toContain('Signature: custom=')
        expect(result.output[0]).toContain('X-Hub-Signature-256: custom=')
      })

      it('should preserve all output lines from verify mode', async () => {
        const options: ExecuteCommandOptions = {
          mode: 'verify',
          repo: 'test-org/test-repo',
          secret: 'test-secret',
          prefix: 'sha256=',
          upper: false,
          opts: {
            timestamp: '2025-12-07T12:00:00.000Z',
            signature: 'sha256=wrong',
          },
        }

        const result = await executeCommand(options)

        expect(result.output.length).toBe(3)
        expect(result.output[0]).toContain('Match:')
        expect(result.output[1]).toContain('Expected:')
        expect(result.output[2]).toContain('Provided:')
      })
    })
  })
})

