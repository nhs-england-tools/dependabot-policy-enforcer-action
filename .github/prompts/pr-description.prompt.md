---
description: Generate a filled-in PR description from the current branch's git history and diff, using the repo's PR template. Returns a markdown codeblock ready to paste into GitHub.
---

# PR Description

Generate a filled-in PR description for the current branch and return it as a single markdown code block the user can copy directly into GitHub.

## Steps

### 1. Read the template

Read `.github/PULL_REQUEST_TEMPLATE.md`. This defines the sections and their intent.

### 2. Gather git context

First, determine the base branch from the open PR:

```bash
gh pr view --json baseRefName --jq '.baseRefName'
```

Then use that base branch in the diff commands:

```bash
git log origin/<base>..HEAD --oneline
git diff origin/<base>..HEAD --stat
git diff origin/<base>..HEAD
```

Use this to understand:

- **What changed** — which files, what kind of edits
- **Why** — infer from commit messages and the nature of the diff
- **How it was tested** — test files changed, CI configuration, `Makefile` conventions

### 3. Ask for acceptance criteria

Before writing the QA testing instructions, check whether the user has provided acceptance criteria (ACs) in their message. If not, ask:

> "What are the acceptance criteria for this PR? I need them to write accurate QA testing instructions."

Wait for the response before continuing.

### 4. Fill in each section

Write concise prose for each template section (2–5 sentences each).

**Description**: what the PR does and why — lead with the outcome, not the implementation detail.

**Testing carried out**: what the author did to verify the change. If test files were changed, reference them. Be honest about coverage.

**QA testing instructions**: numbered steps a QA engineer can follow on a clean environment. Be specific — reference endpoints, UI paths, or commands. If there is no user-visible effect (e.g. pure refactor), say so and suggest a smoke test.

### 5. Return the result

Output **only** a single fenced markdown code block containing the filled-in template. No commentary before or after.

- Preserve the template's heading structure exactly, including any HTML comments before headings
- Strip the placeholder HTML comments from inside each section — replace them with the real content
