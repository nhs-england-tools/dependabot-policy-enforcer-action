import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildCommentBody,
  buildErrorCommentBody,
  postPrComment,
  postErrorPrComment,
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
  HttpClient: vi.fn().mockImplementation(function () {
    return {
      get: mockHttp.get,
      post: mockHttp.post,
      patch: mockHttp.patch,
      dispose: mockHttp.dispose,
    }
  }),
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
    const body = buildCommentBody('passed', makePolicy(), 'enforce', 'https://example.com/report')
    expect(body).toContain(COMMENT_MARKER)
  })

  it('should always start with COMMENT_MARKER', () => {
    const body = buildCommentBody('passed', makePolicy({ mode: 'report' }), 'report', 'https://example.com/report')
    expect(body.startsWith(COMMENT_MARKER)).toBe(true)
  })

  it('should include heading', () => {
    const body = buildCommentBody('passed', makePolicy(), 'enforce', 'https://example.com/report')
    expect(body).toContain('## 🤖 Dependabot Policy Check')
  })

  it('should show passed status with checkmark', () => {
    const body = buildCommentBody('passed', makePolicy(), 'enforce', 'https://example.com/report')
    expect(body).toContain('✅ Passed')
    expect(body).not.toContain('❌')
  })

  it('should show failed status with cross', () => {
    const body = buildCommentBody('failed', makePolicy(), 'enforce', 'https://example.com/report')
    expect(body).toContain('❌ Failed')
    expect(body).not.toContain('✅')
  })

  it('should show exempted status with warning', () => {
    const body = buildCommentBody('exempted', makePolicy(), 'enforce', 'https://example.com/report')
    expect(body).toContain('⚠️ Exempted — dependency update detected')
    expect(body).not.toContain('✅')
    expect(body).not.toContain('❌')
  })

  it('should show error status with error message', () => {
    const body = buildCommentBody('error', makePolicy(), 'enforce', 'https://example.com/report')
    expect(body).toContain('❌ Error — policy check could not complete')
    expect(body).not.toContain('✅')
    expect(body).not.toContain('⚠️')
  })

  it('should include ### Summary: section', () => {
    const body = buildCommentBody('passed', makePolicy(), 'enforce', 'https://example.com/report')
    expect(body).toContain('### Summary:')
  })

  it('should render summary entries as bullet list', () => {
    const body = buildCommentBody('failed', makePolicy({ summary: { totalOpenAlerts: 3, violatingAlerts: 1 } }), 'enforce', 'https://example.com/report')
    expect(body).toContain('- **totalOpenAlerts:** 3')
    expect(body).toContain('- **violatingAlerts:** 1')
  })

  it('should render empty summary with no bullet items', () => {
    const body = buildCommentBody('passed', makePolicy({ summary: {} }), 'enforce', 'https://example.com/report')
    const summaryIdx = body.indexOf('### Summary:')
    const violationsIdx = body.indexOf('### Violations:')
    const between = body.slice(summaryIdx, violationsIdx)
    expect(between).not.toContain('- **')
  })

  it('should include ### Violations: section', () => {
    const body = buildCommentBody('passed', makePolicy(), 'enforce', 'https://example.com/report')
    expect(body).toContain('### Violations:')
  })

  it('should render violations as count bullet list', () => {
    const body = buildCommentBody('failed', makePolicy({
      findings: { critical: ['a', 'b'], medium: ['c'] },
    }), 'enforce', 'https://example.com/report')
    expect(body).toContain('- **critical:** 2')
    expect(body).toContain('- **medium:** 1')
  })

  it('should render empty violations with no bullet items', () => {
    const body = buildCommentBody('passed', makePolicy({ findings: {} }), 'enforce', 'https://example.com/report')
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
    await postPrComment('tok', 'test-org/test-repo', null, VALID_BODY, 'passed', 'enforce')

    expect(mockHttp.get).not.toHaveBeenCalled()
    expect(mockHttp.post).not.toHaveBeenCalled()
    expect(mockHttp.patch).not.toHaveBeenCalled()
  })

  it('should create a comment when no existing bot comment is found', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, '[]'))
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, '{}'))

    await postPrComment('tok', 'test-org/test-repo', 7, VALID_BODY, 'passed', 'enforce')

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

    await postPrComment('tok', 'test-org/test-repo', 7, VALID_BODY, 'failed', 'enforce')

    expect(mockHttp.patch).toHaveBeenCalledOnce()
    expect(mockHttp.post).not.toHaveBeenCalled()
    const [patchUrl, body] = mockHttp.patch.mock.calls[0] as [string, string]
    expect(patchUrl).toContain('/issues/comments/55')
  })

  it('should post a passed comment with ✅ in body', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, '[]'))
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, '{}'))

    await postPrComment('tok', 'test-org/test-repo', 1, VALID_BODY, 'passed', 'enforce')

    const [, postBody] = mockHttp.post.mock.calls[0] as [string, string]
    expect(JSON.parse(postBody).body).toContain('✅ Passed')
  })

  it('should post a failed comment with ❌ in body', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, '[]'))
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, '{}'))

    await postPrComment('tok', 'test-org/test-repo', 1, VALID_BODY, 'failed', 'enforce')

    const [, postBody] = mockHttp.post.mock.calls[0] as [string, string]
    expect(JSON.parse(postBody).body).toContain('❌ Failed')
  })

  it('should post an exempted comment with ⚠️ in body', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, '[]'))
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, '{}'))

    await postPrComment('tok', 'test-org/test-repo', 1, VALID_BODY, 'exempted', 'enforce')

    const [, postBody] = mockHttp.post.mock.calls[0] as [string, string]
    expect(JSON.parse(postBody).body).toContain('⚠️ Exempted — dependency update detected')
  })

  it('should use Bearer token in Authorization header', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, '[]'))
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, '{}'))

    await postPrComment('my-secret-token', 'test-org/test-repo', 3, VALID_BODY, 'passed', 'enforce')

    const [_, headers] = mockHttp.get.mock.calls[0] as [string, Record<string, string>]

    expect(headers['Authorization']).toBe('Bearer my-secret-token')
  })

  it('should propagate HTTP errors', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(403, 'Forbidden'))

    await expect(
      postPrComment('tok', 'test-org/test-repo', 1, VALID_BODY, 'passed', 'enforce'),
    ).rejects.toThrow('HTTP 403')
  })

  it('should retry on transient 502 and succeed on second attempt', async () => {
    mockHttp.get
      .mockResolvedValueOnce(makeResponse(502, 'Bad Gateway'))
      .mockResolvedValueOnce(makeResponse(200, '[]'))
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, '{}'))

    await postPrComment('tok', 'test-org/test-repo', 1, VALID_BODY, 'passed', 'enforce')

    expect(mockHttp.get).toHaveBeenCalledTimes(2)
    expect(mockHttp.post).toHaveBeenCalledOnce()
  })

  it('should retry on transient 503 and succeed on second attempt', async () => {
    mockHttp.get
      .mockResolvedValueOnce(makeResponse(503, 'Service Unavailable'))
      .mockResolvedValueOnce(makeResponse(200, '[]'))
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, '{}'))

    await postPrComment('tok', 'test-org/test-repo', 1, VALID_BODY, 'passed', 'enforce')

    expect(mockHttp.get).toHaveBeenCalledTimes(2)
    expect(mockHttp.post).toHaveBeenCalledOnce()
  })

  it('should throw after exhausting retries on persistent 504', async () => {
    mockHttp.get
      .mockResolvedValueOnce(makeResponse(504, 'Gateway Timeout'))
      .mockResolvedValueOnce(makeResponse(504, 'Gateway Timeout'))

    await expect(
      postPrComment('tok', 'test-org/test-repo', 1, VALID_BODY, 'passed', 'enforce'),
    ).rejects.toThrow('HTTP 504')
  })

  it('should not retry on non-transient errors like 401', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(401, 'Unauthorized'))

    await expect(
      postPrComment('tok', 'test-org/test-repo', 1, VALID_BODY, 'passed', 'enforce'),
    ).rejects.toThrow('HTTP 401')

    expect(mockHttp.get).toHaveBeenCalledOnce()
  })

  it('should split owner and repo correctly from repo string', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, '[]'))
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, '{}'))

    await postPrComment('tok', 'my-org/my-repo', 9, VALID_BODY, 'passed', 'enforce')

    const [listUrl] = mockHttp.get.mock.calls[0] as [string]
    expect(listUrl).toContain('/repos/my-org/my-repo/issues/9/comments')
  })
})

// ---------------------------------------------------------------------------
// buildErrorCommentBody
// ---------------------------------------------------------------------------

describe('buildErrorCommentBody', () => {
  it('should include the COMMENT_MARKER', () => {
    const body = buildErrorCommentBody('enforce', 'timeout', 500, 'org/repo')
    expect(body).toContain(COMMENT_MARKER)
  })

  it('should always start with COMMENT_MARKER', () => {
    const body = buildErrorCommentBody('enforce', 'timeout', 500, 'org/repo')
    expect(body.startsWith(COMMENT_MARKER)).toBe(true)
  })

  it('should show error status line', () => {
    const body = buildErrorCommentBody('enforce', 'timeout', 500, 'org/repo')
    expect(body).toContain('❌ Error — policy check could not complete')
  })

  it('should include the mode', () => {
    const body = buildErrorCommentBody('report', 'timeout', 500, 'org/repo')
    expect(body).toContain('**Mode:** report')
  })

  it('should show HTTP status code when provided', () => {
    const body = buildErrorCommentBody('enforce', 'Server Error', 500, 'org/repo')
    expect(body).toContain('HTTP 500')
    expect(body).not.toContain('could not be reached')
  })

  it('should show error message when statusCode is null', () => {
    const body = buildErrorCommentBody('enforce', 'ECONNREFUSED', null, 'org/repo')
    expect(body).toContain('could not be reached: ECONNREFUSED')
    expect(body).not.toContain('HTTP')
  })

  it('should include the dependabot alerts link', () => {
    const body = buildErrorCommentBody('enforce', 'err', 500, 'my-org/my-repo')
    expect(body).toContain('https://github.com/my-org/my-repo/security/dependabot')
  })

  it('should include guidance to contact the platform team', () => {
    const body = buildErrorCommentBody('enforce', 'err', 500, 'org/repo')
    expect(body).toContain('contact the platform team')
  })
})

// ---------------------------------------------------------------------------
// postErrorPrComment
// ---------------------------------------------------------------------------

describe('postErrorPrComment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should do nothing when prNumber is null', async () => {
    await postErrorPrComment('tok', 'org/repo', null, 'enforce', 'err', 500)

    expect(mockHttp.get).not.toHaveBeenCalled()
    expect(mockHttp.post).not.toHaveBeenCalled()
  })

  it('should create an error comment when no existing comment is found', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, '[]'))
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, '{}'))

    await postErrorPrComment('tok', 'org/repo', 3, 'enforce', 'Server Error', 500)

    expect(mockHttp.post).toHaveBeenCalledOnce()
    const [, postBody] = mockHttp.post.mock.calls[0] as [string, string]
    const parsed = JSON.parse(postBody).body as string
    expect(parsed).toContain(COMMENT_MARKER)
    expect(parsed).toContain('❌ Error')
    expect(parsed).toContain('HTTP 500')
  })

  it('should update an existing comment when the marker is found', async () => {
    const existing: GithubComment[] = [
      { id: 99, body: EXISTING_COMMENT_BODY, user: { type: 'Bot', login: 'github-actions[bot]' } },
    ]
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, JSON.stringify(existing)))
    mockHttp.patch.mockResolvedValueOnce(makeResponse(200, '{}'))

    await postErrorPrComment('tok', 'org/repo', 3, 'enforce', 'err', 500)

    expect(mockHttp.patch).toHaveBeenCalledOnce()
    expect(mockHttp.post).not.toHaveBeenCalled()
    const [patchUrl] = mockHttp.patch.mock.calls[0] as [string]
    expect(patchUrl).toContain('/issues/comments/99')
  })

  it('should post error body with null statusCode for network failures', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, '[]'))
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, '{}'))

    await postErrorPrComment('tok', 'org/repo', 3, 'enforce', 'ECONNREFUSED', null)

    const [, postBody] = mockHttp.post.mock.calls[0] as [string, string]
    const parsed = JSON.parse(postBody).body as string
    expect(parsed).toContain('could not be reached: ECONNREFUSED')
  })
})

