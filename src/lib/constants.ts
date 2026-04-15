/**
 * Known package and dependency management file names used to detect whether a
 * pull request is attempting to fix a dependency vulnerability.
 */
export const PACKAGE_FILE_NAMES = new Set([
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

export const PACKAGE_FILE_EXTENSIONS = ['.gemspec', '.csproj', '.fsproj', '.vbproj']
