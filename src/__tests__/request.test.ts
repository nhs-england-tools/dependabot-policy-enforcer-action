import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'
import { sendPolicyRequest, truncateBody } from '../../src/lib/request.js'
import { hmacHex } from '../../src/lib/signing.js'

describe('sendPolicyRequest', () => {
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
          endpointUrl = `http://127.0.0.1:${address.port}/check`
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

  it('should send correct signed headers', async () => {
    const result = await sendPolicyRequest({
      repo: 'test-org/test-repo',
      secret: 'test-secret',
      endpoint: endpointUrl,
    })

    expect(result.statusCode).toBe(200)
    expect(lastHeaders?.['x-hub-repository']).toBe('test-org/test-repo')
    expect(lastHeaders?.['x-hub-timestamp']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/)
    expect(lastHeaders?.['x-hub-signature-256']).toMatch(/^sha256=[0-9a-f]{64}$/)
    expect(lastHeaders?.['content-type']).toBe('application/json')
  })

  it('should send a valid HMAC signature', async () => {
    await sendPolicyRequest({
      repo: 'test-org/test-repo',
      secret: 'verify-me',
      endpoint: endpointUrl,
    })

    const timestamp = lastHeaders?.['x-hub-timestamp'] as string
    const signatureHeader = lastHeaders?.['x-hub-signature-256'] as string
    const sigHex = signatureHeader.replace('sha256=', '')
    const expectedPayload = `test-org/test-repo:${timestamp}`
    const expectedHex = hmacHex('verify-me', expectedPayload)

    expect(sigHex).toBe(expectedHex)
  })

  it('should send {"action":"check"} as request body', async () => {
    await sendPolicyRequest({
      repo: 'test-org/test-repo',
      secret: 'test-secret',
      endpoint: endpointUrl,
    })

    expect(JSON.parse(lastBody)).toEqual({ action: 'check' })
  })

  it('should return status code and body on success', async () => {
    nextStatus = 200
    nextResponseBody = { status: 'compliant' }

    const result = await sendPolicyRequest({
      repo: 'test-org/test-repo',
      secret: 'test-secret',
      endpoint: endpointUrl,
    })

    expect(result.statusCode).toBe(200)
    expect(result.body).toContain('compliant')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('should return non-2xx status codes', async () => {
    nextStatus = 403
    nextResponseBody = { error: 'FORBIDDEN_REPO' }

    const result = await sendPolicyRequest({
      repo: 'test-org/test-repo',
      secret: 'test-secret',
      endpoint: endpointUrl,
    })

    expect(result.statusCode).toBe(403)
    expect(result.body).toContain('FORBIDDEN_REPO')
  })

  it('should truncate response bodies exceeding 2000 chars', async () => {
    nextStatus = 200
    nextResponseBody = { data: 'x'.repeat(3000) }

    const result = await sendPolicyRequest({
      repo: 'test-org/test-repo',
      secret: 'test-secret',
      endpoint: endpointUrl,
    })

    expect(result.body.length).toBeLessThanOrEqual(2100) // 2000 + truncation message
    expect(result.body).toContain('truncated')
  })

  it('should handle connection errors gracefully', async () => {
    await expect(
      sendPolicyRequest({
        repo: 'test-org/test-repo',
        secret: 'test-secret',
        endpoint: 'http://127.0.0.1:1/never-listening',
        timeoutMs: 2000,
      })
    ).rejects.toThrow()
  })

  it('should measure duration', async () => {
    const result = await sendPolicyRequest({
      repo: 'test-org/test-repo',
      secret: 'test-secret',
      endpoint: endpointUrl,
    })

    expect(typeof result.durationMs).toBe('number')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })
})

describe('truncateBody', () => {
  it('should return the body unchanged when below the limit', () => {
    const body = 'x'.repeat(1999)
    expect(truncateBody(body)).toBe(body)
  })

  it('should return the body unchanged when exactly at the limit', () => {
    const body = 'x'.repeat(2000)
    expect(truncateBody(body)).toBe(body)
  })

  it('should truncate body exceeding the limit and append overflow message', () => {
    const body = 'x'.repeat(2500)
    const result = truncateBody(body)
    expect(result).toMatch(/… \[truncated 500 chars\]$/)
    expect(result.startsWith('x'.repeat(2000))).toBe(true)
  })

  it('should return an empty string unchanged', () => {
    expect(truncateBody('')).toBe('')
  })
})
