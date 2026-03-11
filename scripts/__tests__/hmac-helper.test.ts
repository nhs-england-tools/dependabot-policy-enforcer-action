import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import {
  parseArgs,
  hmacHex,
  handleGenerate,
  handleVerify,
  handleInvalid,
  executeCommand,
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

