import { HttpClient } from "@actions/http-client";
import { githubHeaders, USER_AGENT, GITHUB_API_BASE } from "./github.js";

/**
 * Known package and dependency management file names used to detect whether a
 * pull request is attempting to fix a dependency vulnerability.
 */
const PACKAGE_FILE_NAMES = new Set([
  // JavaScript / Node.js
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".npmrc",
  // Ruby
  "Gemfile",
  "Gemfile.lock",
  // Go
  "go.mod",
  // Rust
  "Cargo.toml",
  "Cargo.lock",
  // PHP
  "composer.json",
  "composer.lock",
  // Java / Kotlin (Maven & Gradle)
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  // Python (requirements.txt like files handled in isPackageFile)
  "pipfile",
  "pipfile.lock",
  "Pipfile",
  "Pipfile.lock",
  "setup.py",
  "setup.cfg",
  "pyproject.toml",
  "poetry.lock",
  "uv.lock",
  // .NET / NuGet
  "nuget.config",
  "packages.config",
  "paket.dependencies",
  "paket.lock",
  // Dart / Flutter
  "pubspec.yaml",
  "pubspec.lock",
]);

const PACKAGE_FILE_EXTENSIONS = [".gemspec", ".csproj", ".fsproj", ".vbproj"];

const ACTION_FILE_PREFIXES = [".github/actions/", ".github/workflows/"];

export interface PrFile {
  filename: string;
  status: string;
}

/**
 * Returns true when the given file path looks like a package or dependency
 * management file (e.g. package.json, go.mod, requirements-dev.txt).
 */
export function isPackageFile(filename: string): boolean {
  const base = filename.split("/").pop() ?? filename;
  if (PACKAGE_FILE_NAMES.has(base)) return true;
  if (/^requirements.*\.txt$/.test(base)) return true;
  return PACKAGE_FILE_EXTENSIONS.some((ext) => base.endsWith(ext));
}

/**
 * Returns true when the given file path is inside the .github/actions or
 * .github/workflows directories, indicating a GitHub Actions definition change.
 */
export function isActionFile(filename: string): boolean {
  return ACTION_FILE_PREFIXES.some((prefix) => filename.startsWith(prefix));
}

/**
 * Returns true when the file is either a package/dependency management file
 * or a GitHub Actions definition file — i.e. the PR could be fixing a
 * vulnerable dependency or action.
 */
export function isFileDependencyUpdate(filename: string): boolean {
  return isPackageFile(filename) || isActionFile(filename);
}

/**
 * Calls the GitHub REST API: GET /repos/{owner}/{repo}/pulls/{prNumber}/files
 * Will fetch max 3000 files (30 pages of 100) before giving up. Github limits to 3000 results for this endpoint,
 * so this should be sufficient for all PRs.
 *
 * Returns true if the given PR includes changes to files that look like package/dependency management files or
 * GitHub Actions definition files, indicating that the PR may be attempting to fix a vulnerable dependency or action.
 **/
export async function isDependencyUpdate(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<boolean> {
  const client = new HttpClient(USER_AGENT);
  let page = 1;
  const maxPages = 30;
  try {
    while (page <= maxPages) {
      const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=2&page=${page}`;
      const { files, hasNextPage } = await getPageOfFiles(
        client,
        url,
        githubHeaders(token),
      );

      // check if files contains any package files or action files, if so we can stop and return immediately
      if (files.some(isFileDependencyUpdate)) return true;
      if (!hasNextPage) break;
      page++;
      if (page > maxPages) {
        throw new Error(`PR #${prNumber} has more than ${maxPages * 100} changed files, which exceeds the maximum that can be checked for dependency updates.`);
      }
    }
  } finally {
    client.dispose();
  }
  return false;
}

export async function getPageOfFiles(
  client: HttpClient,
  url: string,
  headers: Record<string, string>,
): Promise<{ files: string[]; hasNextPage: boolean }> {
  const response = await client.get(url, headers);
  const body = await response.readBody();
  const status = response.message.statusCode ?? 0;
  if (status < 200 || status >= 300) {
    throw new Error(`GitHub API error listing PR files: HTTP ${status}`);
  }
  const responseHeaders = response.message.headers;
  const pageFiles = (JSON.parse(body) as PrFile[]).map((f) => f.filename);
  let hasNextPage = true;
  if (
    !responseHeaders.link ||
    ![responseHeaders.link].flat().join(", ").includes('rel="next"')
  ) {
    hasNextPage = false;
  }
  return { files: pageFiles, hasNextPage };
}
