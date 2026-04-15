/**
 * PR comment module for the Dependabot Policy Enforcer action.
 *
 * Builds a structured markdown comment summarising the policy result and
 * upserts it on the pull request (idempotent: identified by COMMENT_MARKER).
 */

import { HttpClient } from '@actions/http-client'
import { PACKAGE_FILE_NAMES, PACKAGE_FILE_EXTENSIONS } from './constants.js'

const USER_AGENT = 'dependabot-policy-enforcer-action'
const GITHUB_API_BASE = 'https://api.github.com'

/** HTML marker embedded in every comment body, used to find and update it. */
export const COMMENT_MARKER = '<!-- dependabot-policy-enforcer -->'

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

export interface PrFile {
  filename: string
  status: string
}

export interface PolicyResponse {
  pipelinePasses: string
  mode: string
  repository: string
  summary: Record<string, number>
  findings: Record<string, Array<unknown>>
  message?: string
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function extractPrNumber(eventName?: string, ref?: string): number | null {
  if (!eventName || !ref) return null
  if (eventName !== 'pull_request' && eventName !== 'pull_request_target') return null
  const m = /refs\/pull\/(\d+)\//.exec(ref)
  return m ? Number.parseInt(m[1], 10) : null
}

export function buildCommentBody(passed: boolean, policy: PolicyResponse, mode: string, url: string): string {
  const statusLine = passed ? '**Status:** ✅ Passed' : '**Status:** ❌ Failed'
  const lines: string[] = [COMMENT_MARKER, '## 🤖 Dependabot Policy Check', '', statusLine]

  const modeLine = `**Mode:** ${mode}`
  lines.push(modeLine)
  const summary = policy.summary ?? {}
  lines.push('', '### Summary:')
  for (const [key, value] of Object.entries(summary)) {
    lines.push(`- **${key}:** ${value}`)
  }

  const violations = policy.findings ?? {}
  lines.push('', '### Violations:')
  for (const [key, value] of Object.entries(violations)) {
    lines.push(`- **${key}:** ${value.length}`)
  }

  lines.push('', `### [View dependabot alerts](${url})`)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// GitHub API types
// ---------------------------------------------------------------------------

export interface GithubComment {
  id: number
  body: string
  user: { type: string; login: string } | null
}

export interface CommentOptions {
  token: string
  owner: string
  repo: string
  prNumber: number
}

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

function githubHeaders(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

// ---------------------------------------------------------------------------
// Package file detection
// ---------------------------------------------------------------------------

/**
 * Returns true when the given file path looks like a package or dependency
 * management file (e.g. package.json, go.mod, requirements-dev.txt).
 */
export function isPackageFile(filename: string): boolean {
  const base = (filename.split('/').pop() ?? filename)
  if (PACKAGE_FILE_NAMES.has(base)) return true
  if (/^requirements.*\.txt$/.test(base)) return true
  return PACKAGE_FILE_EXTENSIONS.some(ext => base.endsWith(ext))
}

/**
 * Returns the list of file paths changed by a pull request.
 * Calls the GitHub REST API: GET /repos/{owner}/{repo}/pulls/{prNumber}/files
 */
export async function getChangedFiles(token: string, owner: string, repo: string, prNumber: number): Promise<string[]> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`
  const client = new HttpClient(USER_AGENT)
  try {
    const response = await client.get(url, githubHeaders(token))
    const body = await response.readBody()
    const status = response.message.statusCode ?? 0
    if (status < 200 || status >= 300) {
      throw new Error(`GitHub API error listing PR files: HTTP ${status}`)
    }
    return (JSON.parse(body) as PrFile[]).map(f => f.filename)
  } finally {
    client.dispose()
  }
}

// ---------------------------------------------------------------------------
// GitHub API calls — PR comments
// ---------------------------------------------------------------------------

async function listPrComments(opts: CommentOptions): Promise<GithubComment[]> {
  const { token, owner, repo, prNumber } = opts
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`
  const client = new HttpClient(USER_AGENT)
  try {
    const response = await client.get(url, githubHeaders(token))
    const body = await response.readBody()
    const status = response.message.statusCode ?? 0
    if (status < 200 || status >= 300) {
      throw new Error(`GitHub API error listing comments: HTTP ${status}`)
    }
    return JSON.parse(body) as GithubComment[]
  } finally {
    client.dispose()
  }
}

async function createPrComment(opts: CommentOptions, body: string): Promise<void> {
  const { token, owner, repo, prNumber } = opts
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${prNumber}/comments`
  const client = new HttpClient(USER_AGENT)
  try {
    const response = await client.post(url, JSON.stringify({ body }), {
      ...githubHeaders(token),
      'Content-Type': 'application/json',
    })
    const status = response.message.statusCode ?? 0
    if (status !== 201) {
      const responseBody = await response.readBody()
      throw new Error(`GitHub API error creating comment: HTTP ${status} ${responseBody}`)
    }
    await response.readBody()
  } finally {
    client.dispose()
  }
}

async function updatePrComment(
  opts: Omit<CommentOptions, 'prNumber'> & { commentId: number },
  body: string,
): Promise<void> {
  const { token, owner, repo, commentId } = opts
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/comments/${commentId}`
  const client = new HttpClient(USER_AGENT)
  try {
    const response = await client.patch(url, JSON.stringify({ body }), {
      ...githubHeaders(token),
      'Content-Type': 'application/json',
    })
    const status = response.message.statusCode ?? 0
    if (status !== 200) {
      const responseBody = await response.readBody()
      throw new Error(`GitHub API error updating comment: HTTP ${status} ${responseBody}`)
    }
    await response.readBody()
  } finally {
    client.dispose()
  }
}

// ---------------------------------------------------------------------------
// Idempotent upsert
// ---------------------------------------------------------------------------

async function upsertPrComment(opts: CommentOptions, body: string): Promise<void> {
  const comments = await listPrComments(opts)
  const existing = comments.find(
    c => typeof c.body === 'string' && c.body.includes(COMMENT_MARKER),
  )
  if (existing) {
    await updatePrComment(
      { token: opts.token, owner: opts.owner, repo: opts.repo, commentId: existing.id },
      body,
    )
  } else {
    await createPrComment(opts, body)
  }
}

export async function postPrComment(githubToken: string, repo: string, prNumber: number | null, body: PolicyResponse, passed: boolean, mode: string): Promise<void> {
  if (prNumber !== null) {
    const [owner, repoName] = repo.split('/')
    const url = `https://github.com/${owner}/${repoName}/security/dependabot`
    const commentBody = buildCommentBody(passed, body, mode, url)
    await upsertPrComment(
      { token: githubToken, owner, repo: repoName, prNumber },
      commentBody,
    )
  }
}
