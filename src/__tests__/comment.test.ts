import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  extractPrNumber,
  buildCommentBody,
  postPrComment,
  isPackageFile,
  getChangedFiles,
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
  const get = vi.fn<() => Promise<typeof response>>().mockResolvedValue(response)
  const post = vi.fn<() => Promise<typeof response>>().mockResolvedValue(response)
  const patch = vi.fn<() => Promise<typeof response>>().mockResolvedValue(response)

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
// extractPrNumber
// ---------------------------------------------------------------------------

describe('extractPrNumber', () => {
  it('should extract PR number from pull_request ref', () => {
    expect(extractPrNumber('pull_request', 'refs/pull/42/merge')).toBe(42)
  })

  it('should extract PR number from pull_request_target ref', () => {
    expect(extractPrNumber('pull_request_target', 'refs/pull/7/merge')).toBe(7)
  })

  it('should return null for push event', () => {
    expect(extractPrNumber('push', 'refs/heads/main')).toBeNull()
  })

  it('should return null when eventName is undefined', () => {
    expect(extractPrNumber(undefined, 'refs/pull/1/merge')).toBeNull()
  })

  it('should return null when ref is undefined', () => {
    expect(extractPrNumber('pull_request', undefined)).toBeNull()
  })

  it('should return null when ref does not contain a PR number', () => {
    expect(extractPrNumber('pull_request', 'refs/heads/feature')).toBeNull()
  })
})

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
    const [listUrl] = mockHttp.get.mock.calls[0] as [string]
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
    const [patchUrl] = mockHttp.patch.mock.calls[0] as [string]
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

// ---------------------------------------------------------------------------
// isPackageFile
// ---------------------------------------------------------------------------

describe('isPackageFile', () => {
  it.each([
    'package.json',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'Gemfile',
    'Gemfile.lock',
    'go.mod',
    'go.sum',
    'Cargo.toml',
    'Cargo.lock',
    'composer.json',
    'composer.lock',
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    'Pipfile',
    'Pipfile.lock',
    'setup.py',
    'pyproject.toml',
    'poetry.lock',
    'uv.lock',
    'nuget.config',
    'packages.config',
    'pubspec.yaml',
    'pubspec.lock',
  ])('should return true for %s', (filename: string) => {
    expect(isPackageFile(filename)).toBe(true)
  })

  it('should return true for requirements.txt', () => {
    expect(isPackageFile('requirements.txt')).toBe(true)
  })

  it('should return true for requirements-dev.txt', () => {
    expect(isPackageFile('requirements-dev.txt')).toBe(true)
  })

  it('should return true for requirements_test.txt', () => {
    expect(isPackageFile('requirements_test.txt')).toBe(true)
  })

  it('should return true for a .gemspec file', () => {
    expect(isPackageFile('my-gem.gemspec')).toBe(true)
  })

  it('should return true for a .csproj file', () => {
    expect(isPackageFile('MyApp.csproj')).toBe(true)
  })

  it('should return true for a .fsproj file', () => {
    expect(isPackageFile('MyLib.fsproj')).toBe(true)
  })

  it('should return true for a .vbproj file', () => {
    expect(isPackageFile('MyApp.vbproj')).toBe(true)
  })

  it('should return true for a nested path like deps/package.json', () => {
    expect(isPackageFile('deps/package.json')).toBe(true)
  })

  it('should return true for a deeply nested path like a/b/c/go.mod', () => {
    expect(isPackageFile('a/b/c/go.mod')).toBe(true)
  })

  it('should return false for a TypeScript source file', () => {
    expect(isPackageFile('src/index.ts')).toBe(false)
  })

  it('should return false for a workflow YAML file', () => {
    expect(isPackageFile('.github/workflows/ci.yml')).toBe(false)
  })

  it('should return false for a README', () => {
    expect(isPackageFile('README.md')).toBe(false)
  })

  it('should return false for a file named requirements-notes.md', () => {
    expect(isPackageFile('requirements-notes.md')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getChangedFiles
// ---------------------------------------------------------------------------

describe('getChangedFiles', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return the list of filenames from the API response', async () => {
    const files = [
      { filename: 'package.json', status: 'modified' },
      { filename: 'src/index.ts', status: 'added' },
    ]
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, JSON.stringify(files)))

    const result = await getChangedFiles('tok', 'org', 'repo', 3)

    expect(result).toEqual(['package.json', 'src/index.ts'])
  })

  it('should request the correct API URL', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, '[]'))

    await getChangedFiles('tok', 'my-org', 'my-repo', 42)

    const [url] = mockHttp.get.mock.calls[0] as [string]
    expect(url).toContain('/repos/my-org/my-repo/pulls/42/files')
  })

  it('should include Bearer token in Authorization header', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, '[]'))

    await getChangedFiles('secret-token', 'org', 'repo', 1)

    const [, headers] = mockHttp.get.mock.calls[0] as [string, Record<string, string>]
    expect(headers['Authorization']).toBe('Bearer secret-token')
  })

  it('should return an empty array when the PR has no changed files', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, '[]'))

    const result = await getChangedFiles('tok', 'org', 'repo', 1)

    expect(result).toEqual([])
  })

  it('should throw when the API returns a non-2xx status', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(403, 'Forbidden'))

    await expect(getChangedFiles('tok', 'org', 'repo', 1)).rejects.toThrow(
      'GitHub API error listing PR files: HTTP 403',
    )
  })

  it('should call dispose() even when the request throws', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(500, 'Internal Server Error'))

    await expect(getChangedFiles('tok', 'org', 'repo', 1)).rejects.toThrow()
    expect(mockHttp.dispose).toHaveBeenCalledOnce()
  })

  it('should call dispose() on success', async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, '[]'))

    await getChangedFiles('tok', 'org', 'repo', 1)

    expect(mockHttp.dispose).toHaveBeenCalledOnce()
  })
})
