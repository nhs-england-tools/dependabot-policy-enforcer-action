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

export async function getDependabotAlerts(token: string, owner: string, repo: string): Promise<any> {
  const headers = githubHeaders(token)
  const allAlerts: any[] = []
  const perPage = 100
  let url: string | null = `${GITHUB_API_BASE}/repos/${owner}/${repo}/dependabot/alerts?state=open&per_page=${perPage}`

  while (url) {
    const res: Response = await fetch(url, {
      method: 'GET',
      headers: {
        ...headers,
      },
    })
    if ( res.status === 403 ) {
      const responseBody = await res.text()
      if (responseBody.includes("Dependabot alerts are disabled for this repository.")) {
        throw new Error(`GitHub API error: Dependabot alerts are disabled for this repository. ${res.status} ${responseBody}`)
      }
      else {
        throw new Error(`GitHub API error: github token requires the vulnerability-alerts permission ${res.status} ${responseBody}`)
      }
    }

    if (res.status !== 200) {
      const responseBody = await res.text()
      throw new Error(`GitHub API error: HTTP ${res.status} ${responseBody}`)
    }

    const data = await res.json()

    if (data.length === 0) {
      break
    }

    allAlerts.push(...data)

    // Parse Link header for next page
    const linkHeader: string | null = res.headers.get('link')
    url = null
    if (linkHeader) {
      const nextLink: string | undefined = linkHeader.split(',').find((link: string) => link.includes('rel="next"'))
      if (nextLink) {
        const match: RegExpMatchArray | null = nextLink.match(/<([^>]+)>/)
        if (match) {
          url = match[1]
        }
      }
    }
  }

  return allAlerts.map((alert: any) => ({
    severity: alert.security_vulnerability.severity,
    url: alert.url,
    number: alert.number,
    created_at: alert.created_at,
  }))
}


export function githubHeaders(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}
