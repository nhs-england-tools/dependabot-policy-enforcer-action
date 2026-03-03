/**
 * Shared HMAC-SHA256 signing library.
 *
 * This is the single source of truth for signature generation and verification.
 * Used by both the GitHub Action entry point (src/main.ts) and the CLI tool
 * (scripts/hmac-helper.ts).
 */

import crypto from 'node:crypto'

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

export function nowIso(): string {
  const d = new Date()
  return new Date(d.getTime() - (d.getMilliseconds() % 1000)).toISOString().replace(/\.\d{3}Z$/, '.000Z')
}

export function applyOffset(baseIso: string, offset?: string): string {
  if (!offset) return baseIso
  const regex = /^([+-]?)(\d+)([smh])$/
  const m = regex.exec(offset)
  if (!m) throw new Error('Invalid --offset format. Use e.g. -300s, +2m, -1h')
  const sign = m[1] === '-' ? -1 : 1
  const amount = Number.parseInt(m[2], 10)
  const unit = m[3]
  let msByUnit: number
  if (unit === 's') {
    msByUnit = 1000
  } else if (unit === 'm') {
    msByUnit = 60_000
  } else {
    msByUnit = 3_600_000
  }
  const base = new Date(baseIso).getTime()
  const ts = base + sign * amount * msByUnit
  return new Date(ts).toISOString().replace(/\.\d{3}Z$/, '.000Z')
}

// ---------------------------------------------------------------------------
// HMAC core
// ---------------------------------------------------------------------------

export function hmacHex(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

export function withPrefix(sig: string, prefix?: string): string {
  const p = typeof prefix === 'string' ? prefix : 'sha256='
  return `${p}${sig}`
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OutputData {
  repo: string
  timestamp: string
  signature: string
  prefix: string
}

export interface GenerateOptions {
  repo: string
  secret: string
  timestamp?: string
  offset?: string
  prefix?: string
  upper?: boolean
}

export interface VerifyOptions {
  repo: string
  secret: string
  timestamp: string
  signature: string
}

export interface VerifyResult {
  match: boolean
  expected: string
  provided: string
}

export type InvalidKind = 'wrong-secret' | 'wrong-repo' | 'wrong-timestamp' | 'uppercase' | 'no-prefix'

export interface InvalidOptions {
  repo: string
  secret: string
  kind?: InvalidKind
  timestamp?: string
  offset?: string
  prefix?: string
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatOutput(data: OutputData): string {
  const { repo, timestamp, signature, prefix } = data
  const lines = [
    `Repository: ${repo}`,
    `Timestamp: ${timestamp}`,
    `Signature: ${prefix}${signature}`,
    '',
    'Headers:',
    `  X-Hub-Repository: ${repo}`,
    `  X-Hub-Timestamp: ${timestamp}`,
    `  X-Hub-Signature-256: ${prefix}${signature}`,
  ]
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Signature generation / verification
// ---------------------------------------------------------------------------

export function generateSignature(opts: GenerateOptions): OutputData {
  const { repo, secret, timestamp, offset, prefix = 'sha256=', upper = false } = opts
  const baseTs = timestamp || nowIso()
  const ts = applyOffset(baseTs, offset)
  const payload = `${repo}:${ts}`
  let sigHex = hmacHex(secret, payload)
  if (upper) sigHex = sigHex.toUpperCase()
  return { repo, timestamp: ts, signature: sigHex, prefix }
}

export function verifySignature(opts: VerifyOptions): VerifyResult {
  const { repo, secret, timestamp, signature } = opts
  const payload = `${repo}:${timestamp}`
  const expected = hmacHex(secret, payload)
  const provided = signature.replace(/^sha256=/i, '')
  const match = expected.toLowerCase() === provided.toLowerCase()
  return { match, expected, provided }
}

export function generateInvalidSignature(opts: InvalidOptions): OutputData {
  const { repo, secret, kind = 'wrong-secret', timestamp, offset, prefix = 'sha256=' } = opts
  const baseTs = timestamp || nowIso()
  const ts = applyOffset(baseTs, offset)
  const payload = `${repo}:${ts}`
  let sigHex: string
  let actualPrefix = prefix

  switch (kind) {
    case 'wrong-secret':
      sigHex = hmacHex(secret ? secret + '_wrong' : 'wrong', payload)
      break
    case 'wrong-repo':
      sigHex = hmacHex(secret || 'secret', `WRONG/${repo}:${ts}`)
      break
    case 'wrong-timestamp':
      sigHex = hmacHex(secret || 'secret', `${repo}:1999-01-01T00:00:00.000Z`)
      break
    case 'uppercase':
      sigHex = hmacHex(secret || 'secret', payload).toUpperCase()
      break
    case 'no-prefix':
      sigHex = hmacHex(secret || 'secret', payload)
      actualPrefix = ''
      break
    default:
      throw new Error(`Invalid kind: ${kind}. Use one of: wrong-secret, wrong-repo, wrong-timestamp, uppercase, no-prefix`)
  }

  return { repo, timestamp: ts, signature: sigHex, prefix: actualPrefix }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationError {
  error: string
}

export function validateRequiredOptions(
  repo: string,
  secret: string,
  mode: string
): ValidationError | null {
  if (!repo) {
    return { error: 'Missing --repo' }
  }
  if ((mode === 'generate' || mode === 'verify') && !secret) {
    return { error: 'Missing --secret' }
  }
  return null
}
