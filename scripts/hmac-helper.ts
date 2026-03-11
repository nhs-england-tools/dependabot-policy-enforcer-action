#!/usr/bin/env node
/**
 * HMAC Helper CLI for Event API development
 *
 * Features:
 * - generate: create signature for repo/timestamp
 * - verify: check headers against secret
 * - invalid: intentionally produce invalid signatures/headers for testing
 *
 * Usage examples:
 *   node scripts/hmac-helper.ts generate --repo NHSDigital/repo --secret secret
 *   node scripts/hmac-helper.ts generate --repo NHSDigital/repo --secret secret --timestamp 2025-01-01T00:00:00.000Z
 *   node scripts/hmac-helper.ts generate --repo NHSDigital/repo --secret secret --offset -300s
 *   node scripts/hmac-helper.ts invalid --repo NHSDigital/repo --secret secret --kind wrong-secret
 *   node scripts/hmac-helper.ts verify --repo ... --timestamp ... --signature sha256=<hex> --secret secret
 *   node scripts/hmac-helper.ts request --repo NHSDigital/repo --secret secret --endpoint <url>  (--endpoint is required)
 */

import http from 'node:http'
import https from 'node:https'
import { fileURLToPath, URL } from 'node:url'

// Import signing functions from the shared library (single source of truth)
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
} from '../src/lib/signing.js'
import { truncateBody } from '../src/lib/request.js'

// Re-export for consumers of this module
export {
  nowIso,
  applyOffset,
  hmacHex,
  withPrefix,
  formatOutput,
  generateSignature,
  verifySignature,
  generateInvalidSignature,
  validateRequiredOptions,
}
export type {
  OutputData,
  GenerateOptions,
  VerifyOptions,
  VerifyResult,
  InvalidKind,
  InvalidOptions,
  ValidationError,
} from '../src/lib/signing.js'

type IncomingHttpHeaders = http.IncomingHttpHeaders

const DEFAULT_METHOD = 'POST'
const DEFAULT_TIMEOUT_MS = 10_000

type Mode = 'generate' | 'verify' | 'invalid' | 'request'

export function parseArgs(argv = process.argv) {
  const args = argv.slice(2)
  const mode = (args[0] as Mode) || 'generate'
  const opts: Record<string, string | boolean | undefined> = {}
  let i = 1
  while (i < args.length) {
    const a = args[i]
    if (a.startsWith('--')) {
      const eqIdx = a.indexOf('=')
      if (eqIdx > 0) {
        // Format: --key=value
        const k = a.slice(2, eqIdx)
        const v = a.slice(eqIdx + 1)
        opts[k] = v
        i++
      } else {
        // Format: --key value or --key (boolean flag)
        const k = a.slice(2)
        const nextArg = args[i + 1]
        if (nextArg && !nextArg.startsWith('--')) {
          // Next arg is the value
          opts[k] = nextArg
          i += 2 // Skip both current and next arg since we consumed both
        } else {
          // Boolean flag
          opts[k] = true
          i++
        }
      }
    } else {
      i++
    }
  }
  return { mode, opts }
}

function parseJsonOption(value: string, source: string): unknown {
  try {
    return JSON.parse(value)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`${source} must be valid JSON: ${message}`)
  }
}

interface BuildRequestBodyOptions {
  action?: string
  body?: string
  context?: string
}

function buildRequestBody({ action = 'check', body, context }: BuildRequestBodyOptions): string {
  if (body) {
    const parsed = parseJsonOption(body, '--body')
    return JSON.stringify(parsed)
  }

  const payload: Record<string, unknown> = { action }
  if (context) {
    payload.context = parseJsonOption(context, '--context')
  }
  return JSON.stringify(payload)
}

function indentMultiline(text: string, indent = '    '): string {
  return text
    .split('\n')
    .map(line => `${indent}${line}`)
    .join('\n')
}

function sendHttpRequest(options: HttpRequestOptions): Promise<HttpRequestResult> {
  const target = new URL(options.url)
  const transport = target.protocol === 'https:' ? https : http
  const requestOptions: https.RequestOptions = {
    method: options.method,
    hostname: target.hostname,
    port: target.port ? Number(target.port) : undefined,
    path: `${target.pathname}${target.search}` || '/',
    headers: options.headers,
  }

  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const req = transport.request(requestOptions, res => {
      const chunks: string[] = []
      res.setEncoding('utf8')
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const durationMs = Date.now() - startedAt
        resolve({
          statusCode: res.statusCode ?? 0,
          statusMessage: res.statusMessage,
          headers: res.headers,
          body: chunks.join(''),
          durationMs,
        })
      })
    })

    req.on('error', err => {
      reject(err)
    })

    if (options.timeoutMs && options.timeoutMs > 0) {
      req.setTimeout(options.timeoutMs, () => {
        req.destroy(new Error(`Request timed out after ${options.timeoutMs}ms`))
      })
    }

    req.write(options.body)
    req.end()
  })
}

export interface GenerateHandlerOptions {
  repo: string
  secret: string
  timestamp?: string
  offset?: string
  prefix: string
  upper: boolean
}

export interface RequestHandlerOptions extends GenerateHandlerOptions {
  endpoint: string
  method: string
  action?: string
  body?: string
  context?: string
  timeoutMs?: number
}

export function handleGenerate(opts: GenerateHandlerOptions): OutputData {
  return generateSignature({
    repo: opts.repo,
    secret: opts.secret,
    timestamp: opts.timestamp,
    offset: opts.offset,
    prefix: opts.prefix,
    upper: opts.upper,
  })
}

export interface VerifyHandlerOptions {
  repo: string
  secret: string
  timestamp: string
  signature: string
}

export interface VerifyHandlerResult {
  result: VerifyResult
  output: string[]
  exitCode: number
}

export function handleVerify(opts: VerifyHandlerOptions): VerifyHandlerResult {
  if (!opts.timestamp || !opts.signature) {
    throw new Error('Missing --timestamp and/or --signature (e.g., sha256=<hex>)')
  }

  const result = verifySignature({
    repo: opts.repo,
    secret: opts.secret,
    timestamp: opts.timestamp,
    signature: opts.signature,
  })

  const output: string[] = [`Match: ${result.match}`]
  const exitCode = result.match ? 0 : 2

  if (!result.match) {
    output.push(
      `Expected: sha256=${result.expected}`,
      `Provided: sha256=${result.provided}`
    )
  }

  return { result, output, exitCode }
}

export interface InvalidHandlerOptions {
  repo: string
  secret: string
  kind: InvalidKind
  timestamp?: string
  offset?: string
  prefix: string
}

interface HttpRequestOptions {
  url: string
  method: string
  headers: Record<string, string>
  body: string
  timeoutMs?: number
}

interface HttpRequestResult {
  statusCode: number
  statusMessage?: string
  headers: IncomingHttpHeaders
  body: string
  durationMs: number
}

export function handleInvalid(opts: InvalidHandlerOptions): OutputData {
  return generateInvalidSignature({
    repo: opts.repo,
    secret: opts.secret,
    kind: opts.kind,
    timestamp: opts.timestamp,
    offset: opts.offset,
    prefix: opts.prefix,
  })
}

export async function handleRequest(opts: RequestHandlerOptions): Promise<ExecuteCommandResult> {
  const endpoint = opts.endpoint
  const method = opts.method.toUpperCase() || DEFAULT_METHOD
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS

  const signatureData = handleGenerate({
    repo: opts.repo,
    secret: opts.secret,
    timestamp: opts.timestamp,
    offset: opts.offset,
    prefix: opts.prefix,
    upper: opts.upper,
  })

  const signatureHeader = `${signatureData.prefix}${signatureData.signature}`
  const requestBody = buildRequestBody({
    action: opts.action,
    body: opts.body,
    context: opts.context,
  })

  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(requestBody, 'utf8').toString(),
    'X-Hub-Repository': signatureData.repo,
    'X-Hub-Timestamp': signatureData.timestamp,
    'X-Hub-Signature-256': signatureHeader,
    'User-Agent': 'dependabot-policy-enforcer-action-hmac-helper',
  }

  const response = await sendHttpRequest({
    url: endpoint,
    method,
    headers,
    body: requestBody,
    timeoutMs,
  })

  const responseBody = truncateBody(response.body.trim() || '<empty>')
  const statusLine = response.statusMessage
    ? `${response.statusCode} ${response.statusMessage}`
    : `${response.statusCode}`
  const output: string[] = [
    'Request Headers:',
    indentMultiline(formatOutput(signatureData), '  '),
    '',
    'Response:',
    `  Endpoint: ${endpoint}`,
    `  Method: ${method}`,
    `  Status: ${statusLine}`,
    `  Duration: ${response.durationMs}ms`,
    '  Body:',
    indentMultiline(responseBody, '    '),
  ]

  const success = response.statusCode >= 200 && response.statusCode < 300
  if (!success) {
    output.push('', 'Request failed (non-2xx response)')
  }

  return {
    output,
    exitCode: success ? 0 : 2,
  }
}

export interface ExecuteCommandOptions {
  mode: Mode
  repo: string
  secret: string
  prefix: string
  upper: boolean
  opts: Record<string, string | boolean | undefined>
}

export interface ExecuteCommandResult {
  output: string[]
  exitCode: number
}

type CommandExecutor = (options: ExecuteCommandOptions) => Promise<ExecuteCommandResult>

async function executeGenerateCommand({ repo, secret, prefix, upper, opts }: ExecuteCommandOptions): Promise<ExecuteCommandResult> {
  const result = handleGenerate({
    repo,
    secret,
    timestamp: opts['timestamp'] as string | undefined,
    offset: opts['offset'] as string | undefined,
    prefix,
    upper,
  })
  return {
    output: [formatOutput(result)],
    exitCode: 0,
  }
}

async function executeVerifyCommand({ repo, secret, opts }: ExecuteCommandOptions): Promise<ExecuteCommandResult> {
  const ts = String(opts['timestamp'] || '')
  const signatureHeader = String(opts['signature'] || '')
  try {
    const { output, exitCode } = handleVerify({
      repo,
      secret,
      timestamp: ts,
      signature: signatureHeader,
    })
    return { output, exitCode }
  } catch (err) {
    return {
      output: [(err as Error).message],
      exitCode: 1,
    }
  }
}

async function executeInvalidCommand({ repo, secret, prefix, opts }: ExecuteCommandOptions): Promise<ExecuteCommandResult> {
  const kind = String(opts['kind'] || 'wrong-secret') as InvalidKind
  try {
    const result = handleInvalid({
      repo,
      secret,
      kind,
      timestamp: opts['timestamp'] as string | undefined,
      offset: opts['offset'] as string | undefined,
      prefix,
    })
    return {
      output: [formatOutput(result)],
      exitCode: 0,
    }
  } catch (err) {
    return {
      output: [(err as Error).message],
      exitCode: 1,
    }
  }
}

async function executeRequestCommand({ repo, secret, prefix, upper, opts }: ExecuteCommandOptions): Promise<ExecuteCommandResult> {
  if (!opts['endpoint']) {
    return {
      output: ['Missing --endpoint (required for request mode)'],
      exitCode: 1,
    }
  }
  const endpoint = String(opts['endpoint'])
  const method = String(opts['method'] || DEFAULT_METHOD).toUpperCase()
  const action = (opts['action'] as string | undefined) ?? 'check'
  const body = opts['body'] as string | undefined
  const context = opts['context'] as string | undefined
  const timestamp = opts['timestamp'] as string | undefined
  const offset = opts['offset'] as string | undefined

  let timeoutMs = DEFAULT_TIMEOUT_MS
  if (opts['timeout'] !== undefined) {
    if (opts['timeout'] === true) {
      return {
        output: ['--timeout requires a numeric value in milliseconds'],
        exitCode: 1,
      }
    }
    const parsed = Number(opts['timeout'])
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return {
        output: ['--timeout must be a positive number of milliseconds'],
        exitCode: 1,
      }
    }
    timeoutMs = parsed
  }

  try {
    return await handleRequest({
      repo,
      secret,
      timestamp,
      offset,
      prefix,
      upper,
      endpoint,
      method,
      action,
      body,
      context,
      timeoutMs,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      output: [message],
      exitCode: 1,
    }
  }
}

async function executeUnknownCommand(): Promise<ExecuteCommandResult> {
  return {
    output: ['Usage: hmac-helper <generate|verify|invalid|request> --repo <org/repo> [options]'],
    exitCode: 1,
  }
}

const COMMAND_EXECUTORS: Partial<Record<Mode, CommandExecutor>> = {
  generate: executeGenerateCommand,
  verify: executeVerifyCommand,
  invalid: executeInvalidCommand,
  request: executeRequestCommand,
}

export async function executeCommand(options: ExecuteCommandOptions): Promise<ExecuteCommandResult> {
  const executor = COMMAND_EXECUTORS[options.mode]
  if (!executor) {
    return executeUnknownCommand()
  }
  return executor(options)
}

async function main() {
  const { mode, opts } = parseArgs()
  const repo = String(opts['repo'] || '')
  const secret = String(opts['secret'] || '')
  const prefix = String(opts['prefix'] || 'sha256=')
  const upper = Boolean(opts['upper'] || false)

  // Validate required options
  const validationError = validateRequiredOptions(repo, secret, mode)
  if (validationError) {
    console.error(validationError.error)
    process.exit(1)
  }

  const result = await executeCommand({ mode, repo, secret, prefix, upper, opts })

  result.output.forEach(line => console.log(line))

  if (result.exitCode !== 0) {
    process.exit(result.exitCode)
  }
}

// Only run main if this is the entry point (not imported for testing)
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url)
if (isMainModule) {
  try {
    await main()
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}
