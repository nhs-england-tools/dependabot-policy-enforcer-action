import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildCommentBody,
  postPrComment,
  COMMENT_MARKER,
  type GithubComment,
  type PolicyResponse,
} from '../../src/lib/comment.js'

// ---------------------------------------------------------------------------
// Mock @actions/http-client for HTTP function tests
// ---------------------------------------------------------------------------

const mockHttp = vi.hoisted(() => {
  const dispose = vi.fn()
  const readBody = vi.fn<() => Promise<string>>()
  const message = { statusCode: 200 }
  const response = { readBody, message }
  const get = vi.fn<(url: string, headers?: Record<string, string>) => Promise<typeof response>>().mockResolvedValue(response)
  const post = vi.fn<(url: string, body: string, headers?: Record<string, string>) => Promise<typeof response>>()
  const patch = vi.fn<(url: string, body: string, headers?: Record<string, string>) => Promise<typeof response>>()

  return { dispose, readBody, message, response, get, post, patch }
})

vi.mock('@actions/http-client', () => ({
  HttpClient: vi.fn().mockImplementation(() => ({
    get: mockHttp.get,
    post: mockHttp.post,
    patch: mockHttp.patch,
    dispose: mockHttp.dispose,
  })),
}))

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

const TEST_OPTS = { token: 'gh-token', owner: 'org', repo: 'repo', prNumber: 5 }
const EXISTING_COMMENT_BODY = `${COMMENT_MARKER}\nprevious content`

function makeResponse(statusCode: number, body: string) {
  return {
    message: { statusCode },
    readBody: vi.fn<() => Promise<string>>().mockResolvedValue(body),
  }
}

/** Builds a minimal valid PolicyResponse, merging in any overrides. */
function makePolicy(overrides: Partial<PolicyResponse> = {}): PolicyResponse {
  return {
    pipelinePasses: 'true',
    mode: 'enforce',
    repository: 'org/repo',
    summary: {},
    findings: { critical: [{}] },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// buildCommentBody
// ---------------------------------------------------------------------------

describe('buildCommentBody', () => {
  it('should include the COMMENT_MARKER', () => {
    const body = buildCommentBody(true, makePolicy(), 'enforce', 'https://example.com/report')
    expect(body).toContain(COMMENT_MARKER)
  })

  it('should always start with COMMENT_MARKER', () => {
    const body = buildCommentBody(true, makePolicy({ mode: 'report' }), 'report', 'https://example.com/report')
    expect(body.startsWith(COMMENT_MARKER)).toBe(true)
  })

  it('should include heading', () => {
    const body = buildCommentBody(true, makePolicy(), 'enforce', 'https://example.com/report')
    expect(body).toContain('## 🤖 Dependabot Policy Check')
  })

  it('should show passed status with checkmark', () => {
    const body = buildCommentBody(true, makePolicy(), 'enforce', 'https://example.com/report')
    expect(body).toContain('✅ Passed')
    expect(body).not.toContain('❌')
  })

  it('should show failed status with cross', () => {
    const body = buildCommentBody(false, makePolicy(), 'enforce', 'https://example.com/report')
    expect(body).toContain('❌ Failed')
    expect(body).not.toContain('✅')
  })

  it('should include ### Summary: section', () => {
    const body = buildCommentBody(true, makePolicy(), 'enforce', 'https://example.com/report')
    expect(body).toContain('### Summary:')
  })

  it('should render summary entries as bullet list', () => {
    const body = buildCommentBody(false, makePolicy({ summary: { totalOpenAlerts: 3, violatingAlerts: 1 } }), 'enforce', 'https://example.com/report')
    expect(body).toContain('- **totalOpenAlerts:** 3')
    expect(body).toContain('- **violatingAlerts:** 1')
  })

  it('should render empty summary with no bullet items', () => {
    const body = buildCommentBody(true, makePolicy({ summary: {} }), 'enforce', 'https://example.com/report')
    const summaryIdx = body.indexOf('### Summary:')
    const violationsIdx = body.indexOf('### Violations:')
    const between = body.slice(summaryIdx, violationsIdx)
    expect(between).not.toContain('- **')
  })

  it('should include ### Violations: section', () => {
    const body = buildCommentBody(true, makePolicy(), 'enforce', 'https://example.com/report')
    expect(body).toContain('### Violations:')
  })

  it('should render violations as count bullet list', () => {
    const body = buildCommentBody(false, makePolicy({
      findings: { critical: ['a', 'b'], medium: ['c'] },
    }), 'enforce', 'https://example.com/report')
    expect(body).toContain('- **critical:** 2')
    expect(body).toContain('- **medium:** 1')
  })

  it('should render empty violations with no bullet items', () => {
    const body = buildCommentBody(true, makePolicy({ findings: {} }), 'enforce', 'https://example.com/report')
    const violationsIdx = body.indexOf('### Violations:')
    const afterViolations = body.indexOf('### [View dependabot alerts]')
    const between = body.slice(violationsIdx, afterViolations)
    expect(between).not.toContain('- **')
  })
})

// ---------------------------------------------------------------------------
// postPrComment
// ---------------------------------------------------------------------------

describe('postPrComment', () => {
  beforeEach(() => vi.clearAllMocks())

  const VALID_BODY: PolicyResponse = {
    pipelinePasses: 'compliant',
    mode: 'enforcing',
    repository: 'test-org/test-repo',
    summary: { total: 0 },
    findings: { critical: [{openedAt: '2024-06-01T00:00:00Z'}] },
  }

  it('should do nothing when prNumber is null', async () => {
    await postPrComment('tok', 'test-org/test-repo', null, VALID_BODY, true, 'enforce')

    expect(mockHttp.get).not.toHaveBeenCalled()
    expect(mockHttp.post).not.toHaveBeenCalled()
    expect(mockHttp.patch).not.toHaveBeenCalled()
  })

  it('should create a comment when no existing bot comment is found', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, '[]'))
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, '{}'))

    await postPrComment('tok', 'test-org/test-repo', 7, VALID_BODY, true, 'enforce')

    expect(mockHttp.get).toHaveBeenCalledOnce()
    const [listUrl] = mockHttp.get.mock.calls[0] as [string,]
    expect(listUrl).toContain('/repos/test-org/test-repo/issues/7/comments')

    expect(mockHttp.post).toHaveBeenCalledOnce()
    const [postUrl, postBody] = mockHttp.post.mock.calls[0] as [string, string]
    expect(postUrl).toContain('/repos/test-org/test-repo/issues/7/comments')
    expect(JSON.parse(postBody).body).toContain(COMMENT_MARKER)
  })

  it('should update an existing bot comment when the marker is found', async () => {
    const existing: GithubComment[] = [
      { id: 55, body: EXISTING_COMMENT_BODY, user: { type: 'Bot', login: 'github-actions[bot]' } },
    ]
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, JSON.stringify(existing)))
    mockHttp.patch.mockResolvedValueOnce(makeResponse(200, '{}'))

    await postPrComment('tok', 'test-org/test-repo', 7, VALID_BODY, false, 'enforce')

    expect(mockHttp.patch).toHaveBeenCalledOnce()
    expect(mockHttp.post).not.toHaveBeenCalled()
    const [patchUrl, body] = mockHttp.patch.mock.calls[0] as [string, string]
    expect(patchUrl).toContain('/issues/comments/55')
  })

  it('should post a passed comment with ✅ in body', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, '[]'))
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, '{}'))

    await postPrComment('tok', 'test-org/test-repo', 1, VALID_BODY, true, 'enforce')

    const [, postBody] = mockHttp.post.mock.calls[0] as [string, string]
    expect(JSON.parse(postBody).body).toContain('✅ Passed')
  })

  it('should post a failed comment with ❌ in body', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, '[]'))
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, '{}'))

    await postPrComment('tok', 'test-org/test-repo', 1, VALID_BODY, false, 'enforce')

    const [, postBody] = mockHttp.post.mock.calls[0] as [string, string]
    expect(JSON.parse(postBody).body).toContain('❌ Failed')
  })

  it('should use Bearer token in Authorization header', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, '[]'))
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, '{}'))

    await postPrComment('my-secret-token', 'test-org/test-repo', 3, VALID_BODY, true, 'enforce')

    const [_, headers] = mockHttp.get.mock.calls[0] as [string, Record<string, string>]

    expect(headers['Authorization']).toBe('Bearer my-secret-token')
  })

  it('should propagate HTTP errors', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(403, 'Forbidden'))

    await expect(
      postPrComment('tok', 'test-org/test-repo', 1, VALID_BODY, true, 'enforce'),
    ).rejects.toThrow('HTTP 403')
  })

  it('should split owner and repo correctly from repo string', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, '[]'))
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, '{}'))

    await postPrComment('tok', 'my-org/my-repo', 9, VALID_BODY, true, 'enforce')

    const [listUrl] = mockHttp.get.mock.calls[0] as [string]
    expect(listUrl).toContain('/repos/my-org/my-repo/issues/9/comments')
  })
})

