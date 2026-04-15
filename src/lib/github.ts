/**
 * Common Github functions and helpers for the Dependabot Policy Enforcer action.
 */

export const USER_AGENT = 'dependabot-policy-enforcer-action'
export const GITHUB_API_BASE = 'https://api.github.com'

export function extractPrNumber(eventName?: string, ref?: string): number | null {
  if (!eventName || !ref) return null
  if (eventName !== 'pull_request' && eventName !== 'pull_request_target') return null
  const m = /refs\/pull\/(\d+)\//.exec(ref)
  return m ? Number.parseInt(m[1], 10) : null
}

export function githubHeaders(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

