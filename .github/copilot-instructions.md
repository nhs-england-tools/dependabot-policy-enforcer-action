# GitHub Copilot Instructions

## Project overview

This repository implements a reusable GitHub Action that validates Dependabot policy compliance. It signs each request using HMAC-SHA256 and calls the Dependabot Policy Enforcer API. The action fails the workflow check with a descriptive error if the repository does not meet the policy, or if the secret or configuration is invalid.

## Language and toolchain

- **TypeScript** targeting Node.js 20+
- **Yarn 4.x** for package management (`corepack enable` to activate)
- **Vitest** for unit tests — run with `yarn test --run`
- **asdf** for runtime version pinning (see `.tool-versions`)

## Code style

Follow the `.editorconfig` settings throughout:

- 2-space indentation for all files except Python (4 spaces), Makefiles, and Go (tabs)
- LF line endings
- UTF-8 encoding
- Trailing newline at end of every file
- No trailing whitespace

TypeScript-specific conventions:

- Prefer named exports over default exports
- Use `node:` protocol for built-in imports (e.g. `import crypto from 'node:crypto'`)
- Use explicit types on function signatures; avoid `any`
- Use `const` by default; only use `let` when reassignment is required

## Architecture

```text
scripts/
  hmac-helper.ts          # Core signing logic and CLI tool
  __tests__/
    hmac-helper.test.ts   # Vitest unit tests for all exported functions
.github/
  actions/                # Reusable composite actions (lint, scan, etc.)
  workflows/              # CI/CD pipeline stages
```

The signing logic in `scripts/hmac-helper.ts` is the authoritative reference implementation. Any changes to the signing algorithm must be reflected here and covered by tests.

## Signing algorithm

The HMAC-SHA256 signature is computed as:

```text
payload  = "<owner/repo>:<ISO 8601 UTC timestamp>"
timestamp format: YYYY-MM-DDTHH:mm:ss.000Z  (milliseconds zeroed)
signature = "sha256=" + HMAC-SHA256(secret, payload).hexdigest()
```

Request headers sent with every API call:

| Header | Description |
|--------|-------------|
| `X-Hub-Repository` | Full `owner/repo` from `github.repository` |
| `X-Hub-Timestamp` | UTC timestamp used in the payload |
| `X-Hub-Signature-256` | `sha256=<hex digest>` |

## Security rules — always follow these

- **Never** log, print, or include secrets in any output, file, workflow summary, or test fixture
- Always call `core.setSecret(secret)` immediately after reading a secret input to ensure GitHub Actions masks it in all log output
- The `DEPENDABOT_ENFORCER_SECRET` must be stored as a repository secret — never hardcode it
- The API endpoint URL should be stored as an organisation or repository variable, not hardcoded
- Do not include PII, PID, or any real credentials in code, tests, or commit messages

## Testing

- Every exported function must have unit test coverage in `scripts/__tests__/hmac-helper.test.ts`
- Use `describe` blocks to group related tests and `it` for individual cases
- Mock time-dependent functions (e.g. `nowIso`) using `vi.spyOn` or `vi.fn()` — tests must be deterministic
- Test both happy paths and error/edge cases (missing options, malformed inputs, invalid signatures, expired timestamps, etc.)
- Run the full suite before opening a pull request: `yarn test --run`

## Pull requests

- All PRs must include tests covering new or changed behaviour
- Follow the PR template in `.github/PULL_REQUEST_TEMPLATE.md`
- Do not include PII/PID or sensitive data in the PR description, code, or comments
- Pair or mob programming is encouraged

## CI/CD pipeline

The pipeline is split into named stages in `.github/workflows/`:

| Workflow | Purpose |
|----------|---------|
| `cicd-1-pull-request.yaml` | Commit checks, tests, static analysis — runs on every push and PR |
| `cicd-2-publish.yaml` | Publishes a release artefact |
| `cicd-3-deploy.yaml` | Deploys to an environment |

Reusable job steps are defined as composite actions under `.github/actions/`.
