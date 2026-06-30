import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildCommentBody,
  buildErrorCommentBody,
  postPrComment,
  postErrorPrComment,
  COMMENT_MARKER,
  type GithubComment,
} from "../../src/lib/comment.js";

import { PolicyResponse } from "../../src/lib/dependabotAlertsFetcher.js";

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
  const request = vi.fn<(verb: string, url: string, data?: string | null, headers?: Record<string, string>) => Promise<typeof response>>()

  return { dispose, readBody, message, response, get, post, request }
})

vi.mock("@actions/http-client", () => ({
  HttpClient: vi.fn().mockImplementation(function () {
    return {
      get: mockHttp.get,
      post: mockHttp.post,
      request: mockHttp.request,
      dispose: mockHttp.dispose,
    };
  }),
}));

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

const TEST_OPTS = {
  token: "gh-token",
  owner: "org",
  repo: "repo",
  prNumber: 5,
};
const EXISTING_COMMENT_BODY = `${COMMENT_MARKER}\nprevious content`;

function makeResponse(statusCode: number, body: string) {
  return {
    message: { statusCode },
    readBody: vi.fn<() => Promise<string>>().mockResolvedValue(body),
  };
}

/** Builds a minimal valid PolicyResponse, merging in any overrides. */
function makePolicy(overrides: Partial<PolicyResponse> = {}): PolicyResponse {
  return {
    pipelinePasses: true,
    mode: "enforce",
    repository: "org/repo",
    summary: {},
    findings: {
      blocking: {
        critical: [],
        high: [],
        medium: [],
        low: [],
      },
      informational: {
        critical: [],
        high: [],
        medium: [],
        low: [],
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildCommentBody
// ---------------------------------------------------------------------------

describe("buildCommentBody", () => {
  it("should include the COMMENT_MARKER", () => {
    const body = buildCommentBody(
      "passed",
      makePolicy(),
      "enforce",
      "https://example.com/report",
    );
    expect(body).toContain(COMMENT_MARKER);
  });

  it("should always start with COMMENT_MARKER", () => {
    const body = buildCommentBody(
      "passed",
      makePolicy({ mode: "report" }),
      "report",
      "https://example.com/report",
    );
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
  });

  it("should include heading", () => {
    const body = buildCommentBody(
      "passed",
      makePolicy(),
      "enforce",
      "https://example.com/report",
    );
    expect(body).toContain("## 🤖 Dependabot Policy Check");
  });

  it("should show passed status with checkmark", () => {
    const body = buildCommentBody(
      "passed",
      makePolicy(),
      "enforce",
      "https://example.com/report",
    );
    expect(body).toContain("✅ Passed");
    expect(body).not.toContain("❌");
  });

  it("should show failed status with cross", () => {
    const body = buildCommentBody(
      "failed",
      makePolicy(),
      "enforce",
      "https://example.com/report",
    );
    expect(body).toContain("❌ Failed");
    expect(body).not.toContain("✅");
  });

  it("should show exempted status with warning", () => {
    const body = buildCommentBody(
      "exempted",
      makePolicy(),
      "enforce",
      "https://example.com/report",
    );
    expect(body).toContain("⚠️ Exempted — dependency update detected");
    expect(body).not.toContain("✅");
    expect(body).not.toContain("❌");
  });

  it("should show error status with error message", () => {
    const body = buildCommentBody(
      "error",
      makePolicy(),
      "enforce",
      "https://example.com/report",
    );
    expect(body).toContain("❌ Error — policy check could not complete");
    expect(body).not.toContain("✅");
    expect(body).not.toContain("⚠️");
  });

  it("should include ### Summary: section", () => {
    const body = buildCommentBody(
      "passed",
      makePolicy(),
      "enforce",
      "https://example.com/report",
    );
    expect(body).toContain("### Summary:");
  });

  it("should render summary entries as bullet list", () => {
    const body = buildCommentBody(
      "failed",
      makePolicy({ summary: { totalOpenAlerts: 3, blockingViolatingAlerts: 1 } }),
      "enforce",
      "https://example.com/report",
    );
    expect(body).toContain("- **totalOpenAlerts:** 3");
    expect(body).toContain("- **blockingViolatingAlerts:** 1");
  });

  it("should render empty summary with no bullet items", () => {
    const body = buildCommentBody(
      "passed",
      makePolicy({ summary: {} }),
      "enforce",
      "https://example.com/report",
    );
    const summaryIdx = body.indexOf("### Summary:");
    const violationsIdx = body.indexOf("### 🚨 Violations:");
    const between = body.slice(summaryIdx, violationsIdx);
    expect(between).not.toContain("- **");
  });

  it("should include ### 🚨 Violations: section", () => {
    const body = buildCommentBody(
      "passed",
      makePolicy(),
      "enforce",
      "https://example.com/report",
    );
    expect(body).toContain("### 🚨 Violations:");
  });

  it("should render blocking violations with links", () => {
    const body = buildCommentBody(
      "failed",
      makePolicy({
        findings: {
          blocking: {
            critical: [
              { url: "url-1", age: "10 days", number: 1 },
              { url: "url-2", age: "5 days", number: 2 }
            ],
            high: [],
            medium: [{ url: "url-3", age: "8 days", number: 3 }],
            low: [],
          },
          informational: { critical: [], high: [], medium: [], low: [] },
        },
      }),
      "enforce",
      "https://example.com/report",
    );
    expect(body).toContain(`**critical:** [1](https://example.com/report/1), [2](https://example.com/report/2)`);
    expect(body).not.toContain(`**high:**`);
    expect(body).toContain(`**medium:** [3](https://example.com/report/3)`);
    expect(body).not.toContain(`**low:**`);
  });

  it("should renderAlerts needing attention in a separate section", () => {
    const body = buildCommentBody(
      "passed",
      makePolicy({
        findings: {
          blocking: { critical: [], high: [], medium: [], low: [] },
          informational: {
            critical: [],
            high: [{ url: "url-1", age: "21 days", number: 1 }],
            medium: [],
            low: [],
          },
        },
      }),
      "enforce",
      "https://example.com/report",
    );
    expect(body).toContain("### ⚠️ Alerts needing attention:");
    expect(body).toContain(`**high:** [1](https://example.com/report/1)`);
  });

  it("should not render informational section when there are noAlerts needing attention", () => {
    const body = buildCommentBody(
      "passed",
      makePolicy(),
      "enforce",
      "https://example.com/report",
    );
    expect(body).not.toContain("### ⚠️ Alerts needing attention:");
  });

  it("should render empty violations with 'None'", () => {
    const body = buildCommentBody(
      "passed",
      makePolicy({ findings: { blocking: { critical: [], high: [], medium: [], low: [] }, informational: { critical: [], high: [], medium: [], low: [] } } }),
      "enforce",
      "https://example.com/report",
    );
    const violationsIdx = body.indexOf("### 🚨 Violations:");
    const afterViolations = body.indexOf("### [View dependabot alerts]");
    const between = body.slice(violationsIdx, afterViolations);
    expect(between).toContain("None");
    expect(between).not.toContain("- **critical:**");
    expect(between).not.toContain("- **high:**");
    expect(between).not.toContain("- **medium:**");
    expect(between).not.toContain("- **low:**");
  });

  it("should render a 'passed' comment when Dependabot is disabled", () => {
    const body = buildCommentBody(
      "passed",
      makePolicy({
        summary: {
          totalOpenAlerts: null,
          blockingViolatingAlerts: null,
          informationalViolatingAlerts: null,
          oldestAlert: null,
        },
        message: "Dependabot alerts are disabled for this repository.",
      }),
      "enforce",
      "https://github.com/org/repo/security/dependabot",
    );
    expect(body).toContain("✅ Passed");
    expect(body).toContain("- **totalOpenAlerts:** null");
    expect(body).toContain("- **blockingViolatingAlerts:** null");
    expect(body).toContain("- **informationalViolatingAlerts:** null");
    expect(body).toContain("- **oldestAlert:** null");
    expect(body).toContain("None");
    expect(body).not.toContain("Informational violations");
  });
});
// ---------------------------------------------------------------------------
// postPrComment
// ---------------------------------------------------------------------------

describe("postPrComment", () => {
  beforeEach(() => vi.clearAllMocks());

  const VALID_BODY: PolicyResponse = {
    pipelinePasses: true,
    mode: "enforcing",
    repository: "test-org/test-repo",
    summary: { total: 0 },
    findings: {
      blocking: {
        critical: [{ age: "10 days", url: "url-1", number: 1 }],
        high: [],
        medium: [],
        low: [],
      },
      informational: {
        critical: [],
        high: [],
        medium: [],
        low: [],
      },
    },
  };

  it("should do nothing when prNumber is null", async () => {
    await postPrComment(
      "tok",
      "test-org/test-repo",
      null,
      VALID_BODY,
      "passed",
      "enforce",
    );

    expect(mockHttp.get).not.toHaveBeenCalled()
    expect(mockHttp.post).not.toHaveBeenCalled()
    expect(mockHttp.request).not.toHaveBeenCalled()
  })

  it("should create a comment when no existing bot comment is found", async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, "[]"));
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, "{}"));

    await postPrComment(
      "tok",
      "test-org/test-repo",
      7,
      VALID_BODY,
      "passed",
      "enforce",
    );

    expect(mockHttp.get).toHaveBeenCalledOnce();
    const [listUrl] = mockHttp.get.mock.calls[0] as [string];
    expect(listUrl).toContain("/repos/test-org/test-repo/issues/7/comments");

    expect(mockHttp.post).toHaveBeenCalledOnce();
    const [postUrl, postBody] = mockHttp.post.mock.calls[0] as [string, string];
    expect(postUrl).toContain("/repos/test-org/test-repo/issues/7/comments");
    expect(JSON.parse(postBody).body).toContain(COMMENT_MARKER);
  });

  it('should delete and recreate an existing bot comment when the marker is found', async () => {
    const existing: GithubComment[] = [
      { id: 55, body: EXISTING_COMMENT_BODY, user: { type: 'Bot', login: 'github-actions[bot]' } },
    ]
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, JSON.stringify(existing)))
    mockHttp.request.mockResolvedValueOnce(makeResponse(204, ''))
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, '{}'))

    await postPrComment(
      "tok",
      "test-org/test-repo",
      7,
      VALID_BODY,
      "failed",
      "enforce",
    );

    expect(mockHttp.request).toHaveBeenCalledOnce()
    expect(mockHttp.post).toHaveBeenCalledOnce()
    const [verb, deleteUrl] = mockHttp.request.mock.calls[0] as [string, string]
    expect(verb).toBe('DELETE')
    expect(deleteUrl).toContain('/issues/comments/55')
  })

  it("should post a passed comment with ✅ in body", async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, "[]"));
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, "{}"));

    await postPrComment(
      "tok",
      "test-org/test-repo",
      1,
      VALID_BODY,
      "passed",
      "enforce",
    );

    const [, postBody] = mockHttp.post.mock.calls[0] as [string, string];
    expect(JSON.parse(postBody).body).toContain("✅ Passed");
  });

  it("should post a failed comment with ❌ in body", async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, "[]"));
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, "{}"));

    await postPrComment(
      "tok",
      "test-org/test-repo",
      1,
      VALID_BODY,
      "failed",
      "enforce",
    );

    const [, postBody] = mockHttp.post.mock.calls[0] as [string, string];
    expect(JSON.parse(postBody).body).toContain("❌ Failed");
  });

  it("should post an exempted comment with ⚠️ in body", async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, "[]"));
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, "{}"));

    await postPrComment(
      "tok",
      "test-org/test-repo",
      1,
      VALID_BODY,
      "exempted",
      "enforce",
    );

    const [, postBody] = mockHttp.post.mock.calls[0] as [string, string];
    expect(JSON.parse(postBody).body).toContain(
      "⚠️ Exempted — dependency update detected",
    );
  });

  it("should use Bearer token in Authorization header", async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, "[]"));
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, "{}"));

    await postPrComment(
      "my-secret-token",
      "test-org/test-repo",
      3,
      VALID_BODY,
      "passed",
      "enforce",
    );

    const [_, headers] = mockHttp.get.mock.calls[0] as [
      string,
      Record<string, string>,
    ];

    expect(headers["Authorization"]).toBe("Bearer my-secret-token");
  });

  it("should propagate HTTP errors", async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(403, "Forbidden"));

    await expect(
      postPrComment(
        "tok",
        "test-org/test-repo",
        1,
        VALID_BODY,
        "passed",
        "enforce",
      ),
    ).rejects.toThrow("HTTP 403");
  });

  it("should retry on transient 502 and succeed on second attempt", async () => {
    mockHttp.get
      .mockResolvedValueOnce(makeResponse(502, "Bad Gateway"))
      .mockResolvedValueOnce(makeResponse(200, "[]"));
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, "{}"));

    await postPrComment(
      "tok",
      "test-org/test-repo",
      1,
      VALID_BODY,
      "passed",
      "enforce",
    );

    expect(mockHttp.get).toHaveBeenCalledTimes(2);
    expect(mockHttp.post).toHaveBeenCalledOnce();
  });

  it("should retry on transient 503 and succeed on second attempt", async () => {
    mockHttp.get
      .mockResolvedValueOnce(makeResponse(503, "Service Unavailable"))
      .mockResolvedValueOnce(makeResponse(200, "[]"));
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, "{}"));

    await postPrComment(
      "tok",
      "test-org/test-repo",
      1,
      VALID_BODY,
      "passed",
      "enforce",
    );

    expect(mockHttp.get).toHaveBeenCalledTimes(2);
    expect(mockHttp.post).toHaveBeenCalledOnce();
  });

  it("should throw after exhausting retries on persistent 504", async () => {
    mockHttp.get
      .mockResolvedValueOnce(makeResponse(504, "Gateway Timeout"))
      .mockResolvedValueOnce(makeResponse(504, "Gateway Timeout"));

    await expect(
      postPrComment(
        "tok",
        "test-org/test-repo",
        1,
        VALID_BODY,
        "passed",
        "enforce",
      ),
    ).rejects.toThrow("HTTP 504");
  });

  it("should not retry on non-transient errors like 401", async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(401, "Unauthorized"));

    await expect(
      postPrComment(
        "tok",
        "test-org/test-repo",
        1,
        VALID_BODY,
        "passed",
        "enforce",
      ),
    ).rejects.toThrow("HTTP 401");

    expect(mockHttp.get).toHaveBeenCalledOnce();
  });

  it("should split owner and repo correctly from repo string", async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, "[]"));
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, "{}"));

    await postPrComment(
      "tok",
      "my-org/my-repo",
      9,
      VALID_BODY,
      "passed",
      "enforce",
    );

    const [listUrl] = mockHttp.get.mock.calls[0] as [string];
    expect(listUrl).toContain("/repos/my-org/my-repo/issues/9/comments");
  });
});

// ---------------------------------------------------------------------------
// buildErrorCommentBody
// ---------------------------------------------------------------------------

describe("buildErrorCommentBody", () => {
  it("should include the COMMENT_MARKER", () => {
    const body = buildErrorCommentBody("enforce", "timeout", "org/repo");
    expect(body).toContain(COMMENT_MARKER);
  });

  it("should always start with COMMENT_MARKER", () => {
    const body = buildErrorCommentBody("enforce", "timeout", "org/repo");
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
  });

  it("should show error status line", () => {
    const body = buildErrorCommentBody("enforce", "timeout", "org/repo");
    expect(body).toContain("❌ Error — policy check could not complete");
  });

  it("should include the mode", () => {
    const body = buildErrorCommentBody("report", "timeout", "org/repo");
    expect(body).toContain("**Mode:** report");
  });

  it("should include the provided error message", () => {
    const body = buildErrorCommentBody("enforce", "Server Error", "org/repo");
    expect(body).toContain(
      "The policy enforcement failed with error: Server Error",
    );
  });

  it("should include the dependabot alerts link", () => {
    const body = buildErrorCommentBody("enforce", "err", "my-org/my-repo");
    expect(body).toContain(
      "https://github.com/my-org/my-repo/security/dependabot",
    );
  });

  it("should include guidance to contact the platform team", () => {
    const body = buildErrorCommentBody("enforce", "err", "org/repo");
    expect(body).toContain("contact the platform team");
  });
});

// ---------------------------------------------------------------------------
// postErrorPrComment
// ---------------------------------------------------------------------------

describe("postErrorPrComment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should do nothing when prNumber is null", async () => {
    await postErrorPrComment("tok", "org/repo", null, "enforce", "err");

    expect(mockHttp.get).not.toHaveBeenCalled();
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("should create an error comment when no existing comment is found", async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, "[]"));
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, "{}"));

    await postErrorPrComment("tok", "org/repo", 3, "enforce", "Server Error");

    expect(mockHttp.post).toHaveBeenCalledOnce();
    const [, postBody] = mockHttp.post.mock.calls[0] as [string, string];
    const parsed = JSON.parse(postBody).body as string;
    expect(parsed).toContain(COMMENT_MARKER);
    expect(parsed).toContain("❌ Error");
    expect(parsed).toContain("Server Error");
  });

  it('should delete and recreate an existing comment when the marker is found', async () => {
    const existing: GithubComment[] = [
      { id: 99, body: EXISTING_COMMENT_BODY, user: { type: 'Bot', login: 'github-actions[bot]' } },
    ]
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, JSON.stringify(existing)))
    mockHttp.request.mockResolvedValueOnce(makeResponse(204, ''))
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, '{}'))

    await postErrorPrComment("tok", "org/repo", 3, "enforce", "err");

    expect(mockHttp.request).toHaveBeenCalledOnce()
    expect(mockHttp.post).toHaveBeenCalledOnce()
    const [verb, deleteUrl] = mockHttp.request.mock.calls[0] as [string, string]
    expect(verb).toBe('DELETE')
    expect(deleteUrl).toContain('/issues/comments/99')
  })

  it("should post error body for network failures", async () => {
    mockHttp.get.mockResolvedValueOnce(makeResponse(200, "[]"));
    mockHttp.post.mockResolvedValueOnce(makeResponse(201, "{}"));

    await postErrorPrComment("tok", "org/repo", 3, "enforce", "ECONNREFUSED");

    const [, postBody] = mockHttp.post.mock.calls[0] as [string, string];
    const parsed = JSON.parse(postBody).body as string;
    expect(parsed).toContain(
      "The policy enforcement failed with error: ECONNREFUSED",
    );
  });
});
