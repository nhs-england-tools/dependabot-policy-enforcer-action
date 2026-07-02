import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.hoisted ensures these are available when vi.mock factories execute (hoisted above imports)
const {
  mockGetInput,
  mockSetSecret,
  mockSetFailed,
  mockInfo,
  mockError,
  mockWarning,
  mockedgetDependabotAlerts,
  mockPostPrComment,
  mockPostErrorPrComment,
  mockIsDependencyUpdate,
  mockupsertPrComment,
} = vi.hoisted(() => ({
  mockGetInput: vi.fn(),
  mockSetSecret: vi.fn(),
  mockSetFailed: vi.fn(),
  mockInfo: vi.fn(),
  mockError: vi.fn(),
  mockWarning: vi.fn(),
  mockedgetDependabotAlerts: vi.fn(),
  mockPostPrComment: vi.fn(),
  mockPostErrorPrComment: vi.fn(),
  mockIsDependencyUpdate: vi.fn(),
  mockupsertPrComment: vi.fn(),
}));

vi.mock("@actions/core", () => ({
  getInput: mockGetInput,
  setSecret: mockSetSecret,
  setFailed: mockSetFailed,
  info: mockInfo,
  error: mockError,
  warning: mockWarning,
}));

vi.mock("../../src/lib/comment.js", () => ({
  postPrComment: mockPostPrComment,
  postErrorPrComment: mockPostErrorPrComment,
  upsertPrComment: mockupsertPrComment,
}));

vi.mock("../../src/lib/filecheck.js", () => ({
  isDependencyUpdate: mockIsDependencyUpdate,
}));

vi.mock("../../src/lib/github.js", () => ({
  extractPrNumber: vi.fn().mockReturnValue(null),
  getDependabotAlerts: mockedgetDependabotAlerts,
  isDependabotEnabled: vi.fn().mockResolvedValue(true),
}));

// Import run — the top-level run() call in main.ts will execute with mocked deps
// which is fine since all mocks return undefined/empty by default
import { run } from "../../src/main.js";

describe("Action Entry Point (run)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T00:00:00.000Z"));
    vi.clearAllMocks();
    process.env = { ...originalEnv, GITHUB_REPOSITORY: "test-org/test-repo" };

    // Default input mapping
    mockGetInput.mockImplementation((name: string) => {
      switch (name) {
        case "mode":
          return "enforce";
        case "github-token":
          return "gha-token-abc";
        default:
          return "";
      }
    });

    // Default successful response
    mockedgetDependabotAlerts.mockResolvedValue([
      {
        url: "url-1",
        severity: "MODERATE",
        created_at: "2026-06-16T09:49:05Z",
        number: 1,
        fix_available: true,
      },
    ]);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------
  // Successful request
  // ---------------------------------------------------------------

  it("should log success info", async () => {
    await run();

    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining("Policy check passed"),
    );
  });

  it("should accept report mode", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "github-token") return "gha-token-abc";
      if (name === "mode") return "report";
      return "";
    });

    await run();

    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  it("should fail the action if there is violating alert", async () => {
    mockedgetDependabotAlerts.mockResolvedValue([
      {
        url: "url-1",
        severity: "CRITICAL",
        created_at: "2026-06-01T09:49:05Z",
        number: 1,
        fix_available: true,
      },
    ]);

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("Policy check failed"),
    );
  });

  it("should not fail the action if there is violating alert, but report mode", async () => {
    mockedgetDependabotAlerts.mockResolvedValue([
      {
        url: "url-1",
        severity: "CRITICAL",
        created_at: "2026-06-01T09:49:05Z",
        number: 1,
        fix_available: true,
      },
    ]);

    mockGetInput.mockImplementation((name: string) => {
      if (name === "github-token") return "gha-token-abc";
      if (name === "mode") return "report";
      return "";
    });

    await run();

    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining("Policy check message:"),
    );

    const loggedOutput = mockInfo.mock.calls
      .map(([msg]) => String(msg))
      .join("\n");
    expect(loggedOutput).toContain("Policy check message:");
    expect(loggedOutput).toContain(
      "Dependabot policy check passed in report mode, but 1 alert(s) exceed the defined thresholds",
    );
  });

  it("should not count alerts with no fix available as violating", async () => {
    mockedgetDependabotAlerts.mockResolvedValue([
      {
        url: "url-1",
        severity: "LOW",
        created_at: "2026-06-01T09:49:05Z",
        number: 1,
        fix_available: true,
      },
      {
        url: "url-2",
        severity: "CRITICAL",
        created_at: "2026-06-01T09:49:05Z",
        number: 2,
        fix_available: false,
      },
    ]);

    await run();

    expect(mockSetFailed).not.toHaveBeenCalled();
    const loggedOutput = mockInfo.mock.calls
      .map(([msg]) => String(msg))
      .join("\n");
    expect(loggedOutput).toContain(
      "1 alerts found with no fix available. These alerts are ignored in the policy evaluation. Alerts: url-2",
    );
  });

  it("should pass the pipeline when there are no alerts", async () => {
    mockedgetDependabotAlerts.mockResolvedValue([]);

    await run();

    expect(mockSetFailed).not.toHaveBeenCalled();
    const loggedOutput = mockInfo.mock.calls
      .map(([msg]) => String(msg))
      .join("\n");
    expect(loggedOutput).toContain("Policy check passed");
    expect(loggedOutput).toContain("Fetched Dependabot alerts, with total count: 0");
  });

  // ---------------------------------------------------------------
  // Input validation
  // ---------------------------------------------------------------

  it("should mask github-token immediately after reading it", async () => {
    await run();
    expect(mockSetSecret).toHaveBeenCalledWith("gha-token-abc");
  });

  it("should still call setFailed when github-token is absent", async () => {
    mockGetInput.mockImplementation((name: string) => {
      switch (name) {
        case "mode":
          return "enforce";
        case "github-token":
          return "";
        default:
          return "";
      }
    });

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining(
        "github-token input is required. Please provide a GitHub token with appropriate permissions.",
      ),
    );
  });

  it("should fail when GITHUB_REPOSITORY is not set", async () => {
    delete process.env.GITHUB_REPOSITORY;

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("GITHUB_REPOSITORY"),
    );
    expect(mockedgetDependabotAlerts).not.toHaveBeenCalled();
  });

  it("should fail when mode is not enforce or report", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "github-token") return "gha-token-abc";
      if (name === "mode") return "invalid-mode";
      return "";
    });

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('mode must be either "enforce" or "report"'),
    );
    expect(mockedgetDependabotAlerts).not.toHaveBeenCalled();
  });

  it("should fail when blocking-severity is not a recognised value", async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === "github-token") return "gha-token-abc";
      if (name === "mode") return "enforce";
      if (name === "blocking-severity") return "extreme";
      return "";
    });

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('blocking-severity must be one of'),
    );
    expect(mockedgetDependabotAlerts).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------
  // Errors from mockedgetDependabotAlerts
  // ---------------------------------------------------------------

  it("should call setFailed on non-2xx response", async () => {
    mockedgetDependabotAlerts.mockRejectedValue(new Error("403 Forbidden"));

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("Unexpected error"),
    );
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("403 Forbidden"),
    );
  });

  //   // ---------------------------------------------------------------
  //   // Network / unexpected errors
  //   // ---------------------------------------------------------------

  it("should handle non-Error throws gracefully", async () => {
    mockedgetDependabotAlerts.mockRejectedValue("string error");

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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T00:00:00.000Z"));

    process.env = {
      ...originalEnv,
      GITHUB_REPOSITORY: "test-org/test-repo",
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REF: "refs/pull/12/merge",
    };

    mockGetInput.mockImplementation((name: string) => {
      switch (name) {
        case "github-token":
          return "gha-token-abc";
        case "mode":
          return "enforce";
        default:
          return "";
      }
    });

    mockedgetDependabotAlerts.mockResolvedValue([
      {
        url: "url-1",
        severity: "CRITICAL",
        created_at: "2026-06-16T09:49:05Z",
        number: 1,
        fix_available: true,
      },
    ]);

    mockPostPrComment.mockResolvedValue(undefined);

    const githubMod = await import("../../src/lib/github.js");
    mockExtractPrNumber = githubMod.extractPrNumber as ReturnType<typeof vi.fn>;
    mockExtractPrNumber.mockReturnValue(12);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.useRealTimers();
  });

  it("should call postPrComment with correct args on a PR", async () => {
    await run();

    expect(mockPostPrComment).toHaveBeenCalledOnce();
    const call = mockPostPrComment.mock.calls[0];
    expect(call[0]).toBe("gha-token-abc"); // githubToken
    expect(call[1]).toBe("test-org/test-repo"); // repo
    expect(call[2]).toBe(12); // prNumber
    expect(call[4]).toBe("passed"); // status
    expect(call[5]).toBe("enforce"); // mode
  });

  it("should not log a separate PR comment info message", async () => {
    await run();
    const infoMessages = mockInfo.mock.calls.map(([m]) => String(m));
    expect(infoMessages.some((m) => m.includes("PR comment"))).toBe(false);
  });

  it("should not call postPrComment when github-token is not provided", async () => {
    mockGetInput.mockImplementation((name: string) => {
      switch (name) {
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

  it("should call postPrComment and setFailed when pipelinePasses is false", async () => {
    mockedgetDependabotAlerts.mockResolvedValue([
      {
        url: "url-1",
        severity: "CRITICAL",
        created_at: "2026-06-01T09:49:05Z",
        number: 1,
        fix_available: true,
      },
    ]);

    await run();

    expect(mockPostPrComment).toHaveBeenCalledOnce();
    expect(mockSetFailed).toHaveBeenCalled();
    expect(mockPostPrComment.mock.calls[0][4]).toBe("failed"); // status = failed
  });

  it("should pass info in comment when dependabot disabled", async () => {
    mockedgetDependabotAlerts.mockRejectedValue(
      new Error("Dependabot alerts are disabled for this repository."),
    );

    await run();

    expect(mockPostPrComment).toHaveBeenCalledOnce();
    expect(mockSetFailed).not.toHaveBeenCalled();
    expect(mockPostPrComment.mock.calls[0][4]).toBe("passed"); // status = passed
    expect(mockPostPrComment).toHaveBeenCalledWith(
      "gha-token-abc",
      "test-org/test-repo",
      12,
      expect.objectContaining({
        mode: "enforce",
        repository: "test-repo",
        summary: {
          totalOpenAlerts: null,
          violatingAlerts: null,
          informationalAlerts: null,
          oldestAlert: null,
        },
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
        message: "Dependabot alerts are disabled for this repository.",
        pipelinePasses: true,
      }),
      "passed",
      "enforce",
      "critical",
    );
  });

  it("should warn but not fail when postPrComment throws non 2xx error", async () => {
    mockPostPrComment.mockRejectedValue(new Error("403 Forbidden"));
    await run();
    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining("Failed to post PR comment: 403 Forbidden"),
    );
    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  it("should never include github-token in any logged message", async () => {
    mockPostPrComment.mockRejectedValue(new Error("some error"));
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T00:00:00.000Z"));
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      GITHUB_REPOSITORY: "test-org/test-repo",
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REF: "refs/pull/7/merge",
    };

    mockGetInput.mockImplementation((name: string) => {
      switch (name) {
        case "mode":
          return "enforce";
        case "github-token":
          return "gha-token-abc";
        default:
          return "";
      }
    });

    // Policy response — pipelinePasses is false to trigger the guard
    mockedgetDependabotAlerts.mockResolvedValue([
      {
        url: "url-1",
        severity: "CRITICAL",
        created_at: "2026-06-01T09:49:05Z",
        number: 1,
        fix_available: true,
      },
      {
        url: "url-2",
        severity: "CRITICAL",
        created_at: "2026-06-01T09:49:05Z",
        number: 2,
        fix_available: true,
      },
    ]);

    mockPostPrComment.mockResolvedValue(undefined);
    mockIsDependencyUpdate.mockResolvedValue(false);

    const githubMod = await import("../../src/lib/github.js");
    mockExtractPrNumber = githubMod.extractPrNumber as ReturnType<typeof vi.fn>;
    mockExtractPrNumber.mockReturnValue(7);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should not call setFailed and should pass status 'exempted' to postPrComment when package files are changed", async () => {
    mockIsDependencyUpdate.mockResolvedValue(true);

    await run();

    expect(mockSetFailed).not.toHaveBeenCalled();
    expect(mockPostPrComment).toHaveBeenCalledOnce();
    expect(mockPostPrComment.mock.calls[0][4]).toBe("exempted");
  });

  it("should log summary info when package files have been changed", async () => {
    mockIsDependencyUpdate.mockResolvedValue(true);

    await run();

    const infoMessages = mockInfo.mock.calls
      .map((args: unknown[]) => String(args[0]))
      .join("\n");
    expect(infoMessages).toContain(
      "This PR changes dependency package or github action files. Allowing step to succeed.",
    );
    expect(infoMessages).toContain("Summary");
    expect(infoMessages).toContain('"totalOpenAlerts": 2');
  });

  it("should still call setFailed when no package files are changed", async () => {
    mockIsDependencyUpdate.mockResolvedValue(false);

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("Policy check failed"),
    );
  });

  it("should still call setFailed when prNumber is null", async () => {
    mockExtractPrNumber.mockReturnValue(null);

    await run();

    expect(mockIsDependencyUpdate).not.toHaveBeenCalled();
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("Policy check failed"),
    );
  });

  it("should emit a warning and still call setFailed when getChangedFiles throws", async () => {
    mockIsDependencyUpdate.mockRejectedValue(new Error("API rate limit"));

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
        case "mode":
          return "report";
        case "github-token":
          return "gha-token-abc";
        default:
          return "";
      }
    });

    await run();

    expect(mockIsDependencyUpdate).not.toHaveBeenCalled();
    expect(mockSetFailed).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Error-path PR comment (postErrorPrComment)
// ---------------------------------------------------------------------------

describe("Error-path PR comment", () => {
  let mockExtractPrNumber: ReturnType<typeof vi.fn>;
  const originalEnv = process.env;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      GITHUB_REPOSITORY: "test-org/test-repo",
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REF: "refs/pull/4/merge",
    };

    mockGetInput.mockImplementation((name: string) => {
      switch (name) {
        case "mode":
          return "enforce";
        case "github-token":
          return "gha-token-abc";
        default:
          return "";
      }
    });

    mockPostErrorPrComment.mockResolvedValue(undefined);
    mockPostPrComment.mockResolvedValue(undefined);

    const githubMod = await import("../../src/lib/github.js");
    mockExtractPrNumber = githubMod.extractPrNumber as ReturnType<typeof vi.fn>;
    mockExtractPrNumber.mockReturnValue(4);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should call postErrorPrComment with null statusCode on unexpected error", async () => {
    mockedgetDependabotAlerts.mockRejectedValue(new Error("ECONNREFUSED"));

    await run();

    expect(mockPostErrorPrComment).toHaveBeenCalledOnce();
    expect(mockPostErrorPrComment).toHaveBeenCalledWith(
      "gha-token-abc",
      "test-org/test-repo",
      4,
      "enforce",
      "ECONNREFUSED",
    );
    expect(mockSetFailed).toHaveBeenCalled();
  });

  it("should not call postErrorPrComment when github-token is absent", async () => {
    mockGetInput.mockImplementation((name: string) => {
      switch (name) {
        case "mode":
          return "enforce";
        case "github-token":
          return "";
        default:
          return "";
      }
    });

    mockedgetDependabotAlerts.mockRejectedValue(new Error("ECONNREFUSED"));

    await run();

    expect(mockPostErrorPrComment).not.toHaveBeenCalled();
  });

  it("should warn but not fail if postErrorPrComment throws on non-2xx path", async () => {
    mockedgetDependabotAlerts.mockRejectedValue(new Error("403 Forbidden"));
    mockPostErrorPrComment.mockRejectedValue(new Error("comment API down"));

    await run();

    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining("comment API down"),
    );
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining("403"));
  });

  it("should not call upsertPrComment when not on a pull request", async () => {
    mockExtractPrNumber.mockReturnValue(null);
    mockedgetDependabotAlerts.mockRejectedValue(new Error("ECONNREFUSED"));

    await run();

    expect(mockPostErrorPrComment).toHaveBeenCalledOnce();
    expect(mockPostErrorPrComment.mock.calls[0][2]).toBeNull();
    expect(mockupsertPrComment).not.toHaveBeenCalled();
  });
});
