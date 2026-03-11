/**
 * HTTP request module for the Dependabot Policy Enforcer action.
 *
 * Uses @actions/http-client to send signed policy check requests.
 * The signing logic is delegated to src/lib/signing.ts.
 */

import { HttpClient } from '@actions/http-client'
import { generateSignature } from './signing.js'

const MAX_BODY_LOG_LENGTH = 2_000
const USER_AGENT = 'dependabot-policy-enforcer-action'

export interface PolicyRequestOptions {
  repo: string
  secret: string
  endpoint: string
  timeoutMs?: number
}

export interface PolicyRequestResult {
  statusCode: number
  body: string
  durationMs: number
}

export function truncateBody(body: string): string {
  if (body.length <= MAX_BODY_LOG_LENGTH) {
    return body
  }
  const overflow = body.length - MAX_BODY_LOG_LENGTH
  return `${body.slice(0, MAX_BODY_LOG_LENGTH)}… [truncated ${overflow} chars]`
}

export async function sendPolicyRequest(opts: PolicyRequestOptions): Promise<PolicyRequestResult> {
  const { repo, secret, endpoint, timeoutMs = 10_000 } = opts

  const signatureData = generateSignature({ repo, secret })
  const signatureHeader = `${signatureData.prefix}${signatureData.signature}`
  const requestBody = JSON.stringify({ action: 'check' })

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Hub-Repository': signatureData.repo,
    'X-Hub-Timestamp': signatureData.timestamp,
    'X-Hub-Signature-256': signatureHeader,
  }

  const client = new HttpClient(USER_AGENT, undefined, {
    socketTimeout: timeoutMs,
  })

  const startedAt = Date.now()

  try {
    const response = await client.post(endpoint, requestBody, headers)
    const durationMs = Date.now() - startedAt
    const rawBody = await response.readBody()

    return {
      statusCode: response.message.statusCode ?? 0,
      body: truncateBody(rawBody.trim() || '<empty>'),
      durationMs,
    }
  } finally {
    client.dispose()
  }
}
