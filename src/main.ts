/**
 * GitHub Action entry point for the Dependabot Policy Enforcer.
 *
 * Reads action inputs, generates a signed HMAC-SHA256 request,
 * calls the policy enforcer API, and sets outputs / fails the
 * workflow check based on the response.
 */

import * as core from '@actions/core'
import { sendPolicyRequest } from './lib/request.js'

function validateUrl(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

export async function run(): Promise<void> {
  try {
    // ---------------------------------------------------------------
    // 1. Read inputs
    // ---------------------------------------------------------------
    const secret = core.getInput('secret')
    const endpoint = core.getInput('api-endpoint')
    const timeoutMs = Number.parseInt(core.getInput('timeout-ms') || '10000', 10)
    const repo = process.env.GITHUB_REPOSITORY ?? ''
    const mode = (core.getInput('mode') || 'enforce').trim().toLowerCase()

    // ---------------------------------------------------------------
    // 2. Mask secret immediately
    // ---------------------------------------------------------------
    core.setSecret(secret)

    // ---------------------------------------------------------------
    // 3. Validate inputs
    // ---------------------------------------------------------------
    if (!secret) {
      core.setFailed(
        'secret input is required. ' +
        'Store it as the DEPENDABOT_ENFORCER_SECRET repository secret and reference it in your workflow.'
      )
      return
    }

    if (!endpoint) {
      core.setFailed(
        'api-endpoint input is required. ' +
        'Set it as an organisation or repository variable (vars.DEPENDABOT_ENFORCER_API_ENDPOINT).'
      )
      return
    }

    if (!validateUrl(endpoint)) {
      core.setFailed(
        `api-endpoint value is not a valid URL: "${endpoint}". ` +
        'Provide a fully-qualified URL including the scheme (e.g. https://api.example.com/check).'
      )
      return
    }

    if (!repo) {
      core.setFailed(
        'GITHUB_REPOSITORY environment variable is not set. ' +
        'This action must run inside a GitHub Actions workflow.'
      )
      return
    }

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      core.setFailed(
        `timeout-ms must be a positive number, got "${core.getInput('timeout-ms')}".`
      )
      return
    }

    if (mode !== 'enforce' && mode !== 'report') {
      core.setFailed(
        `mode must be either "enforce" or "report", got "${core.getInput('mode')}".`
      )
      return
    }

    // ---------------------------------------------------------------
    // 4. Send signed request
    // ---------------------------------------------------------------
    core.info(`Checking Dependabot policy for ${repo}…`)

    const result = await sendPolicyRequest({
      repo,
      secret,
      endpoint,
      mode,
      timeoutMs,
    })

    // ---------------------------------------------------------------
    // 5. Set outputs
    // ---------------------------------------------------------------
    core.setOutput('status-code', result.statusCode.toString())
    core.setOutput('response-body', result.body)
    const body = JSON.parse(result.body)

    if (result.statusCode >= 200 && result.statusCode < 300) {
      if (body.pipelinePasses == 'false') {
        core.setFailed(
          `Policy check failed: \n` +
          `${JSON.stringify(body, null, 2)}`
        )
        return
      } else if (body.pipelinePasses == 'true' && body.message) {
        core.info(
          `Policy check message: ${body.message} \n` +
          `Response: ${JSON.stringify(body, null, 2)}`
        )
        return
      }
      core.info(
      `Policy check passed (${result.statusCode}) in ${result.durationMs}ms.`
      )
    } else {
      core.setFailed(
        `Policy check failed with status ${result.statusCode} (${result.durationMs}ms).\n` +
        `Response: ${JSON.stringify(body, null, 2)}`
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    core.setFailed(`Unexpected error: ${message}`)
  }
}

run()
