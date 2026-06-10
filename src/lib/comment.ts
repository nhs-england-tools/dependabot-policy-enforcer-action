/**
 * PR comment module for the Dependabot Policy Enforcer action.
 *
 * Builds a structured markdown comment summarising the policy result and
 * upserts it on the pull request (idempotent: identified by COMMENT_MARKER).
 */

import { HttpClient } from "@actions/http-client";
import { githubHeaders, USER_AGENT, GITHUB_API_BASE } from "./github.js";

/** HTML marker embedded in every comment body, used to find and update it. */
export const COMMENT_MARKER = "<!-- dependabot-policy-enforcer -->";

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

export interface PolicyResponse {
  pipelinePasses: string;
  mode: string;
  repository: string;
  summary: Record<string, number>;
  findings: Record<string, Array<unknown>>;
  message?: string;
}

export type PolicyStatus = "passed" | "failed" | "exempted" | "error";

export function buildCommentBody(
  status: PolicyStatus,
  policy: PolicyResponse,
  mode: string,
  url: string,
): string {
  const statusLine =
    status === "passed"
      ? "**Status:** ✅ Passed"
      : status === "exempted"
        ? "**Status:** ⚠️ Exempted — dependency update detected"
        : status === "error"
          ? "**Status:** ❌ Error — policy check could not complete"
          : "**Status:** ❌ Failed";
  const lines: string[] = [
    COMMENT_MARKER,
    "## 🤖 Dependabot Policy Check",
    "",
    statusLine,
  ];

  const modeLine = `**Mode:** ${mode}`;
  lines.push(modeLine);
  const summary = policy.summary ?? {};
  lines.push("", "### Summary:");
  for (const [key, value] of Object.entries(summary)) {
    lines.push(`- **${key}:** ${value}`);
  }

  const violations = policy.findings ?? {};
  lines.push("", "### Violations:");
  for (const [key, value] of Object.entries(violations)) {
    lines.push(`- **${key}:** ${value.length}`);
  }

  lines.push("", `### [View dependabot alerts](${url})`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// GitHub API types
// ---------------------------------------------------------------------------

export interface GithubComment {
  id: number;
  body: string;
  user: { type: string; login: string } | null;
}

export interface CommentOptions {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
}

// ---------------------------------------------------------------------------
// Retry helper for transient GitHub API failures (502, 503, 504)
// ---------------------------------------------------------------------------

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 1,
  delayMs = 2000,
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isTransient =
        error instanceof Error && /HTTP (502|503|504)/.test(error.message);
      if (!isTransient || attempt === retries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("Retry logic exhausted unexpectedly");
}

// ---------------------------------------------------------------------------
// GitHub API calls — PR comments
// ---------------------------------------------------------------------------

async function listPrComments(opts: CommentOptions): Promise<GithubComment[]> {
  const { token, owner, repo, prNumber } = opts;
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`;
  const client = new HttpClient(USER_AGENT);
  try {
    const response = await client.get(url, githubHeaders(token));
    const body = await response.readBody();
    const status = response.message.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      throw new Error(`GitHub API error listing comments: HTTP ${status}`);
    }
    return JSON.parse(body) as GithubComment[];
  } finally {
    client.dispose();
  }
}

async function createPrComment(
  opts: CommentOptions,
  body: string,
): Promise<void> {
  const { token, owner, repo, prNumber } = opts;
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${prNumber}/comments`;
  const client = new HttpClient(USER_AGENT);
  try {
    const response = await client.post(url, JSON.stringify({ body }), {
      ...githubHeaders(token),
      "Content-Type": "application/json",
    });
    const status = response.message.statusCode ?? 0;
    if (status !== 201) {
      const responseBody = await response.readBody();
      throw new Error(
        `GitHub API error creating comment: HTTP ${status} ${responseBody}`,
      );
    }
    await response.readBody();
  } finally {
    client.dispose();
  }
}

async function updatePrComment(
  opts: Omit<CommentOptions, "prNumber"> & { commentId: number },
  body: string,
): Promise<void> {
  const { token, owner, repo, commentId } = opts;
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/comments/${commentId}`;
  const client = new HttpClient(USER_AGENT);
  try {
    const response = await client.patch(url, JSON.stringify({ body }), {
      ...githubHeaders(token),
      "Content-Type": "application/json",
    });
    const status = response.message.statusCode ?? 0;
    if (status !== 200) {
      const responseBody = await response.readBody();
      throw new Error(
        `GitHub API error updating comment: HTTP ${status} ${responseBody}`,
      );
    }
    await response.readBody();
  } finally {
    client.dispose();
  }
}

// ---------------------------------------------------------------------------
// Idempotent upsert
// ---------------------------------------------------------------------------

async function upsertPrComment(
  opts: CommentOptions,
  body: string,
): Promise<void> {
  await withRetry(async () => {
    const comments = await listPrComments(opts);
    const existing = comments.find(
      (c) => typeof c.body === "string" && c.body.includes(COMMENT_MARKER),
    );
    if (existing) {
      await updatePrComment(
        {
          token: opts.token,
          owner: opts.owner,
          repo: opts.repo,
          commentId: existing.id,
        },
        body,
      );
    } else {
      await createPrComment(opts, body);
    }
  });
}

export async function postPrComment(
  githubToken: string,
  repo: string,
  prNumber: number | null,
  body: PolicyResponse,
  status: PolicyStatus,
  mode: string,
): Promise<void> {
  if (prNumber !== null) {
    const [owner, repoName] = repo.split("/");
    const url = `https://github.com/${owner}/${repoName}/security/dependabot`;
    const commentBody = buildCommentBody(status, body, mode, url);
    await upsertPrComment(
      { token: githubToken, owner, repo: repoName, prNumber },
      commentBody,
    );
  }
}

export function buildErrorCommentBody(
  mode: string,
  errorMessage: string,
  statusCode: number | null,
  repo: string,
): string {
  const [owner, repoName] = repo.split("/");
  const url = `https://github.com/${owner}/${repoName}/security/dependabot`;
  const lines: string[] = [
    COMMENT_MARKER,
    "## 🤖 Dependabot Policy Check",
    "",
    "**Status:** ❌ Error — policy check could not complete",
    `**Mode:** ${mode}`,
    "",
    "### Error:",
    statusCode !== null
      ? `The policy enforcement API returned an error (HTTP ${statusCode}).`
      : `The policy enforcement API could not be reached: ${errorMessage}`,
    "",
    "This does **not** mean your repository has zero alerts — the check could not complete.",
    "Please contact the platform team or re-run the workflow.",
    "",
    `### [View dependabot alerts](${url})`,
  ];
  return lines.join("\n");
}

export async function postErrorPrComment(
  githubToken: string,
  repo: string,
  prNumber: number | null,
  mode: string,
  errorMessage: string,
  statusCode: number | null,
): Promise<void> {
  if (prNumber !== null) {
    const [owner, repoName] = repo.split("/");
    const commentBody = buildErrorCommentBody(
      mode,
      errorMessage,
      statusCode,
      repo,
    );
    await upsertPrComment(
      { token: githubToken, owner, repo: repoName, prNumber },
      commentBody,
    );
  }
}
