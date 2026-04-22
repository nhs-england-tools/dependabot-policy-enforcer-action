import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.hoisted ensures these are available when vi.mock factories execute (hoisted above imports)
const {
  mockGetInput,
  mockSetSecret,
  mockSetFailed,
  mockSetOutput,
  mockInfo,
  mockWarning,
  mockSendPolicyRequest,
  mockPostPrComment,
  mockGetChangedFiles,
} = vi.hoisted(() => ({
  mockGetInput: vi.fn(),
  mockSetSecret: vi.fn(),
  mockSetFailed: vi.fn(),
  mockSetOutput: vi.fn(),
  mockInfo: vi.fn(),
  mockWarning: vi.fn(),
  mockSendPolicyRequest: vi.fn(),
  mockPostPrComment: vi.fn(),
  mockGetChangedFiles: vi.fn(),
}));

vi.mock("@actions/core", () => ({
  getInput: mockGetInput,
  setSecret: mockSetSecret,
  setFailed: mockSetFailed,
  setOutput: mockSetOutput,
  info: mockInfo,
  warning: mockWarning,
}));

vi.mock("../../src/lib/request.js", () => ({
  sendPolicyRequest: mockSendPolicyRequest,
}));

vi.mock("../../src/lib/comment.js", () => ({
  postPrComment: mockPostPrComment,
}));

vi.mock("../../src/lib/filecheck.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/filecheck.js")>();
  return {
    getChangedFiles: mockGetChangedFiles,
    isPackageFile: actual.isPackageFile,
    isActionFile: actual.isActionFile,
    isDependencyUpdate: actual.isDependencyUpdate,
  };
});

vi.mock("../../src/lib/github.js", () => ({
  extractPrNumber: vi.fn().mockReturnValue(null),
}));

// Import run — the top-level run() call in main.ts will execute with mocked deps
// which is fine since all mocks return undefined/empty by default
import { run } from "../../src/main.js";

describe("Action Entry Point (run)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, GITHUB_REPOSITORY: "test-org/test-repo" };

    // Default input mapping
    mockGetInput.mockImplementation((name: string) => {
      switch (name) {
        case "secret":
          return "test-secret-value";
        case "api-endpoint":
          return "https://api.example.com/check";
        case "mode":
          return "enforce";
        case "timeout-ms":
          return "10000";
        default:
          return "";
      }
    });

    // Default successful response
    mockSendPolicyRequest.mockResolvedValue({
      statusCode: 200,
      body: '{"pipelinePasses": true,"status":"compliant"}',
      durationMs: 42,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ---------------------------------------------------------------
  // Secret masking
  // ---------------------------------------------------------------

  it("should call setSecret immediately with the secret value", async () => {
    await run();

    expect(mockSetSecret).toHaveBeenCalledWith("test-secret-value");
    // setSecret should be called before any setFailed/setOutput
    const setSecretOrder = mockSetSecret.mock.invocationCallOrder[0];
    for (const call of mockSetFailed.mock.invocationCallOrder) {
      expect(setSecretOrder).toBeLessThan(call);
    }
  });

  it("should never include the secret in any setFailed or info call", async () => {
    mockSendPolicyRequest.mockRejectedValue(new Error("Network failure"));
    await run();

    for (const call of mockSetFailed.mock.calls) {
      expect(String(call[0])).not.toContain("test-secret-value");
    }
    for (const call of mockInfo.mock.calls) {
      expect(String(call[0])).not.toContain("test-secret-value");
    }
  });

  // ---------------------------------------------------------------
  // Successful request
  // ---------------------------------------------------------------

  it("should set outputs on successful 2xx response", async () => {
    await run();

    expect(mockSetOutput).toHaveBeenCalledWith("status-code", "200");
    expect(mockSetOutput).toHaveBeenCalledWith(
      "response-body",
      '{"pipelinePasses": true,"status":"compliant"}',
    );
    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  it("should log success info", async () => {
    await run();

    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining("passed"));
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining("200"));
  });

  it("should pass correct options to sendPolicyRequest", async () => {
    await run();

    expect(mockSendPolicyRequest).toHaveBeenCalledWith({
      repo: "test-org/test-repo",
      secret: "test-secret-value",
      endpoint: "https://api.example.com/check",
      mode: "enforce",
      timeoutMs: 10000,
    });
  });

  it("should accept report mode", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "secret") return "test-secret-value";
      if (name === "api-endpoint") return "https://api.example.com/check";
      if (name === "mode") return "report";
      if (name === "timeout-ms") return "10000";
      return "";
    });

    await run();

    expect(mockSetFailed).not.toHaveBeenCalled();
    expect(mockSendPolicyRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "test-org/test-repo",
        secret: "test-secret-value",
        endpoint: "https://api.example.com/check",
        mode: "report",
        timeoutMs: 10000,
      }),
    );
  });

  it("should fail the action if pipelinePasses is false in a 2xx response", async () => {
    mockSendPolicyRequest.mockResolvedValue({
      statusCode: 200,
      body: '{"pipelinePasses": false,"status":"non-compliant"}',
      durationMs: 50,
    });

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("Policy check failed"),
    );
    expect(mockSetOutput).toHaveBeenCalledWith("status-code", "200");
    expect(mockSetOutput).toHaveBeenCalledWith(
      "response-body",
      '{"pipelinePasses": false,"status":"non-compliant"}',
    );
  });

  it("should log message and response if pipelinePasses is true with a message", async () => {
    mockSendPolicyRequest.mockResolvedValue({
      statusCode: 200,
      body: '{"pipelinePasses": true,"message":"Some failure"}',
      durationMs: 50,
    });

    await run();

    const loggedOutput = mockInfo.mock.calls
      .map(([msg]) => String(msg))
      .join("\n");
    expect(loggedOutput).toContain("Policy check message:");
    expect(loggedOutput).toContain("Some failure");
  });

  it("should log generic success message if pipelinePasses is true without a message", async () => {
    mockSendPolicyRequest.mockResolvedValue({
      statusCode: 200,
      body: '{"pipelinePasses": true}',
      durationMs: 50,
    });

    await run();

    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining("Policy check passed"),
    );
  });

  // ---------------------------------------------------------------
  // Non-2xx responses
  // ---------------------------------------------------------------

  it("should call setFailed on non-2xx response", async () => {
    mockSendPolicyRequest.mockResolvedValue({
      statusCode: 403,
      body: '{"error":"FORBIDDEN_REPO"}',
      durationMs: 50,
    });

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining("403"));
    // Outputs should still be set
    expect(mockSetOutput).toHaveBeenCalledWith("status-code", "403");
  });

  // ---------------------------------------------------------------
  // Missing / empty inputs
  // ---------------------------------------------------------------

  it("should fail with descriptive message when secret is empty", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "secret") return "";
      if (name === "api-endpoint") return "https://api.example.com/check";
      return "";
    });

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("DEPENDABOT_ENFORCER_SECRET"),
    );
    expect(mockSendPolicyRequest).not.toHaveBeenCalled();
  });

  it("should fail with descriptive message when api-endpoint is empty", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "secret") return "test-secret-value";
      if (name === "api-endpoint") return "";
      return "";
    });

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("api-endpoint"),
    );
    expect(mockSendPolicyRequest).not.toHaveBeenCalled();
  });

  it("should fail when api-endpoint is not a valid URL", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "secret") return "test-secret-value";
      if (name === "api-endpoint") return "not-a-url";
      return "";
    });

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("not a valid URL"),
    );
    expect(mockSendPolicyRequest).not.toHaveBeenCalled();
  });

  it("should fail when GITHUB_REPOSITORY is not set", async () => {
    delete process.env.GITHUB_REPOSITORY;

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("GITHUB_REPOSITORY"),
    );
    expect(mockSendPolicyRequest).not.toHaveBeenCalled();
  });

  it("should fail when timeout-ms is not a valid number", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "secret") return "test-secret-value";
      if (name === "api-endpoint") return "https://api.example.com/check";
      if (name === "timeout-ms") return "abc";
      return "";
    });

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("timeout-ms"),
    );
    expect(mockSendPolicyRequest).not.toHaveBeenCalled();
  });

  it("should fail when mode is not enforce or report", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "secret") return "test-secret-value";
      if (name === "api-endpoint") return "https://api.example.com/check";
      if (name === "mode") return "invalid-mode";
      if (name === "timeout-ms") return "10000";
      return "";
    });

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('mode must be either "enforce" or "report"'),
    );
    expect(mockSendPolicyRequest).not.toHaveBeenCalled();
  });
  // ---------------------------------------------------------------
  // Network / unexpected errors
  // ---------------------------------------------------------------

  it("should catch and report network errors", async () => {
    mockSendPolicyRequest.mockRejectedValue(new Error("ECONNREFUSED"));

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("ECONNREFUSED"),
    );
  });

  it("should catch and report timeout errors", async () => {
    mockSendPolicyRequest.mockRejectedValue(
      new Error("Request timed out after 10000ms"),
    );

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("timed out"),
    );
  });

  it("should handle non-Error throws gracefully", async () => {
    mockSendPolicyRequest.mockRejectedValue("string error");

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("string error"),
    );
  });
});

// ---------------------------------------------------------------------------
// PR comment integration
// ---------------------------------------------------------------------------

describe("PR comment integration", () => {
  // Obtain the mocked extractPrNumber so we can control its return value per test
  let mockExtractPrNumber: ReturnType<typeof vi.fn>;
  const originalEnv = process.env;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      GITHUB_REPOSITORY: "test-org/test-repo",
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REF: "refs/pull/12/merge",
    };

    mockGetInput.mockImplementation((name: string) => {
      switch (name) {
        case "secret":
          return "test-secret-value";
        case "api-endpoint":
          return "https://api.example.com/check";
        case "timeout-ms":
          return "10000";
        case "github-token":
          return "gha-token-abc";
        case "mode":
          return "enforce";
        default:
          return "";
      }
    });

    mockSendPolicyRequest.mockResolvedValue({
      statusCode: 200,
      body: '{"pipelinePasses":true,"mode":"enforce", "summary": {"totalOpenAlerts": 0, "violatingAlerts": 0}, "findings": {"critical": [], "medium": [], "low": []}}',
      durationMs: 30,
    });

    mockPostPrComment.mockResolvedValue(undefined);

    const githubMod = await import("../../src/lib/github.js");
    mockExtractPrNumber = githubMod.extractPrNumber as ReturnType<
      typeof vi.fn
    >;
    mockExtractPrNumber.mockReturnValue(12);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should mask github-token immediately after reading it", async () => {
    await run();
    expect(mockSetSecret).toHaveBeenCalledWith("gha-token-abc");
  });

  it("should call postPrComment with correct args on a PR", async () => {
    await run();

    expect(mockPostPrComment).toHaveBeenCalledOnce();
    const call = mockPostPrComment.mock.calls[0];
    expect(call[0]).toBe("gha-token-abc");     // githubToken
    expect(call[1]).toBe("test-org/test-repo"); // repo
    expect(call[2]).toBe(12);                   // prNumber
    expect(call[4]).toBe('passed');              // status
    expect(call[5]).toBe("enforce");             // mode
  });

  it("should not log a separate PR comment info message", async () => {
    await run();
    const infoMessages = mockInfo.mock.calls.map(([m]) => String(m));
    expect(infoMessages.some(m => m.includes("PR comment"))).toBe(false);
  });

  it("should not call postPrComment when github-token is not provided", async () => {
    mockGetInput.mockImplementation((name: string) => {
      switch (name) {
        case "secret":
          return "test-secret-value";
        case "api-endpoint":
          return "https://api.example.com/check";
        case "timeout-ms":
          return "10000";
        case "github-token":
          return "";
        default:
          return "";
      }
    });

    await run();

    expect(mockPostPrComment).not.toHaveBeenCalled();
  });

  it("should call postPrComment with null prNumber when not on a pull request", async () => {
    mockExtractPrNumber.mockReturnValue(null);

    await run();

    expect(mockPostPrComment).toHaveBeenCalledOnce();
    expect(mockPostPrComment.mock.calls[0][2]).toBeNull();
  });

  it("should emit a warning and not fail when comment posting throws", async () => {
    mockPostPrComment.mockRejectedValue(new Error("403 Forbidden"));

    await run();

    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining("403 Forbidden"),
    );
    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  it("should still set outputs even when comment posting fails", async () => {
    mockPostPrComment.mockRejectedValue(new Error("network error"));

    await run();

    expect(mockSetOutput).toHaveBeenCalledWith("status-code", "200");
    expect(mockSetOutput).toHaveBeenCalledWith(
      "response-body",
      expect.any(String),
    );
  });

  it("should call postPrComment and setFailed when pipelinePasses is false", async () => {
    mockSendPolicyRequest.mockResolvedValue({
      statusCode: 200,
      body: '{"pipelinePasses":"false","status":"non-compliant","summary":{},"findings":{"critical": [], "medium": [], "low": []}}',
      durationMs: 50,
    });

    await run();

    expect(mockPostPrComment).toHaveBeenCalledOnce();
    expect(mockPostPrComment.mock.calls[0][4]).toBe('failed'); // status = failed
    expect(mockSetFailed).toHaveBeenCalled();
  });

  it("should never include github-token in any logged message", async () => {
    mockPostPrComment.mockRejectedValue(new Error('some error'))
    await run();

    for (const call of [
      ...mockInfo.mock.calls,
      ...mockWarning.mock.calls,
      ...mockSetFailed.mock.calls,
    ]) {
      expect(String(call[0])).not.toContain("gha-token-abc");
    }
  });
});

// ---------------------------------------------------------------------------
// Package file change detection in enforce mode
// ---------------------------------------------------------------------------

describe("Package file change detection in enforce mode", () => {
  let mockExtractPrNumber: ReturnType<typeof vi.fn>;
  const originalEnv = process.env;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      GITHUB_REPOSITORY: "test-org/test-repo",
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REF: "refs/pull/7/merge",
    };

    mockGetInput.mockImplementation((name: string) => {
      switch (name) {
        case "secret": return "test-secret-value";
        case "api-endpoint": return "https://api.example.com/check";
        case "mode": return "enforce";
        case "timeout-ms": return "10000";
        case "github-token": return "gha-token-abc";
        default: return "";
      }
    });

    // Policy response — pipelinePasses is false to trigger the guard
    mockSendPolicyRequest.mockResolvedValue({
      statusCode: 200,
      body: '{"pipelinePasses":false,"summary":{"totalOpenAlerts":3}}',
      durationMs: 20,
    });

    mockPostPrComment.mockResolvedValue(undefined);
    mockGetChangedFiles.mockResolvedValue([]);

    const githubMod = await import("../../src/lib/github.js");
    mockExtractPrNumber = githubMod.extractPrNumber as ReturnType<typeof vi.fn>;
    mockExtractPrNumber.mockReturnValue(7);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should not call setFailed and should pass status 'exempted' to postPrComment when package files are changed", async () => {
    mockGetChangedFiles.mockResolvedValue(["package.json", "src/index.ts"]);

    await run();

    expect(mockSetFailed).not.toHaveBeenCalled();
    expect(mockPostPrComment).toHaveBeenCalledOnce();
    expect(mockPostPrComment.mock.calls[0][4]).toBe('exempted');
  });

  it("should not call setFailed when a github workflow file has been changed", async () => {
    mockGetChangedFiles.mockResolvedValue([".github/workflows/ci.yml", "src/index.ts"]);

    await run();

    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  it("should not call setFailed when an action definition file has been changed", async () => {
    mockGetChangedFiles.mockResolvedValue([".github/actions/my-action/action.yml"]);

    await run();

    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  it("should log summary info when package files have been changed", async () => {
    mockGetChangedFiles.mockResolvedValue(["yarn.lock"]);

    await run();

    const infoMessages = mockInfo.mock.calls.map((args: unknown[]) => String(args[0])).join("\n");
    expect(infoMessages).toContain("This PR changes dependency package or github action files. Allowing step to succeed.");
    expect(infoMessages).toContain("Summary");
    expect(infoMessages).toContain('"totalOpenAlerts": 3');

  });

  it("should still call setFailed when no package files are changed", async () => {
    mockGetChangedFiles.mockResolvedValue(["src/index.ts", "README.md"]);

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("Policy check failed"),
    );
  });

  it("should still call setFailed when github-token is absent", async () => {
    mockGetInput.mockImplementation((name: string) => {
      switch (name) {
        case "secret": return "test-secret-value";
        case "api-endpoint": return "https://api.example.com/check";
        case "mode": return "enforce";
        case "timeout-ms": return "10000";
        case "github-token": return "";
        default: return "";
      }
    });

    await run();

    expect(mockGetChangedFiles).not.toHaveBeenCalled();
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("Policy check failed"),
    );
  });

  it("should still call setFailed when prNumber is null", async () => {
    mockExtractPrNumber.mockReturnValue(null);
    mockGetChangedFiles.mockResolvedValue(["package.json"]);

    await run();

    expect(mockGetChangedFiles).not.toHaveBeenCalled();
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("Policy check failed"),
    );
  });

  it("should emit a warning and still call setFailed when getChangedFiles throws", async () => {
    mockGetChangedFiles.mockRejectedValue(new Error("API rate limit"));

    await run();

    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining("API rate limit"),
    );
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("Policy check failed"),
    );
  });

  it("should not apply the package-file check in report mode", async () => {
    mockGetInput.mockImplementation((name: string) => {
      switch (name) {
        case "secret": return "test-secret-value";
        case "api-endpoint": return "https://api.example.com/check";
        case "mode": return "report";
        case "timeout-ms": return "10000";
        case "github-token": return "gha-token-abc";
        default: return "";
      }
    });

    await run();

    expect(mockGetChangedFiles).not.toHaveBeenCalled();
    expect(mockSetFailed).not.toHaveBeenCalled();
  });
});
