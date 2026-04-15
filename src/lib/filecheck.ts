import { HttpClient } from '@actions/http-client'
import { githubHeaders, USER_AGENT, GITHUB_API_BASE } from './github.js'

/**
 * Known package and dependency management file names used to detect whether a
 * pull request is attempting to fix a dependency vulnerability.
 */
const PACKAGE_FILE_NAMES = new Set([
  // JavaScript / Node.js
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '.npmrc',
  // Ruby
  'Gemfile',
  'Gemfile.lock',
  // Go
  'go.mod',
  // Rust
  'Cargo.toml',
  'Cargo.lock',
  // PHP
  'composer.json',
  'composer.lock',
  // Java / Kotlin (Maven & Gradle)
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  // Python (requirements.txt like files handled in isPackageFile)
  'pipfile',
  'pipfile.lock',
  'Pipfile',
  'Pipfile.lock',
  'setup.py',
  'setup.cfg',
  'pyproject.toml',
  'poetry.lock',
  'uv.lock',
  // .NET / NuGet
  'nuget.config',
  'packages.config',
  'paket.dependencies',
  'paket.lock',
  // Dart / Flutter
  'pubspec.yaml',
  'pubspec.lock',
])

const PACKAGE_FILE_EXTENSIONS = ['.gemspec', '.csproj', '.fsproj', '.vbproj']

export interface PrFile {
  filename: string
  status: string
}

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
