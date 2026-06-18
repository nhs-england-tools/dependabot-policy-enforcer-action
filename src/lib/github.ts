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

export async function graphqlQuery(token: string, query: string, variables?: Record<string, unknown>): Promise<any> {
  const headers = githubHeaders(token)
  const res = await fetch(`${GITHUB_API_BASE}/graphql`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  if ( res.status !== 200 ) {
    const responseBody = await res.text()
    throw new Error(`GitHub API error: HTTP ${res.status} ${responseBody}`)
  }

  const data = await res.json()
  if (data.errors) {
    throw new Error(`GitHub API GraphQL errors: ${JSON.stringify(data.errors)}`)
  }
  return data.data.repository.vulnerabilityAlerts.nodes
}


export function githubHeaders(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}
