import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isPackageFile, isActionFile, isDependencyUpdate, getChangedFiles } from '../../src/lib/filecheck.js'

// ---------------------------------------------------------------------------
// Mock @actions/http-client
// ---------------------------------------------------------------------------

const mockHttp = vi.hoisted(() => {
  const dispose = vi.fn()
  const readBody = vi.fn<() => Promise<string>>()
  const message = { statusCode: 200 }
  const response = { readBody, message }
  const get = vi.fn<(url: string, headers?: Record<string, string>) => Promise<typeof response>>().mockResolvedValue(response)

  return { dispose, readBody, message, response, get }
})

vi.mock('@actions/http-client', () => ({
  HttpClient: vi.fn().mockImplementation(() => ({
    get: mockHttp.get,
    dispose: mockHttp.dispose,
  })),
}))

function makeResponse(statusCode: number, body: string) {
  return {
    message: { statusCode },
    readBody: vi.fn<() => Promise<string>>().mockResolvedValue(body),
  }
}

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
// isActionFile
// ---------------------------------------------------------------------------

describe('isActionFile', () => {
  it('should return true for a file inside .github/workflows/', () => {
    expect(isActionFile('.github/workflows/ci.yml')).toBe(true)
  })

  it('should return true for a file inside .github/actions/', () => {
    expect(isActionFile('.github/actions/my-action/action.yml')).toBe(true)
  })

  it('should return true for a nested file deep in .github/workflows/', () => {
    expect(isActionFile('.github/workflows/sub/deploy.yaml')).toBe(true)
  })

  it('should return false for a file in .github/ but not actions or workflows', () => {
    expect(isActionFile('.github/CODEOWNERS')).toBe(false)
  })

  it('should return false for a package file', () => {
    expect(isActionFile('package.json')).toBe(false)
  })

  it('should return false for a source file', () => {
    expect(isActionFile('src/index.ts')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isDependencyUpdate
// ---------------------------------------------------------------------------

describe('isDependencyUpdate', () => {
  it('should return true for a package file', () => {
    expect(isDependencyUpdate('package.json')).toBe(true)
  })

  it('should return true for a lock file', () => {
    expect(isDependencyUpdate('yarn.lock')).toBe(true)
  })

  it('should return true for a workflow file', () => {
    expect(isDependencyUpdate('.github/workflows/ci.yml')).toBe(true)
  })

  it('should return true for an action definition file', () => {
    expect(isDependencyUpdate('.github/actions/my-action/action.yml')).toBe(true)
  })

  it('should return false for a source file', () => {
    expect(isDependencyUpdate('src/index.ts')).toBe(false)
  })

  it('should return false for a README', () => {
    expect(isDependencyUpdate('README.md')).toBe(false)
  })

  it('should return false for a file in .github/ outside actions and workflows', () => {
    expect(isDependencyUpdate('.github/CODEOWNERS')).toBe(false)
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
