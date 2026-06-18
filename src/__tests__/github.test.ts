import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { extractPrNumber, getDependabotAlerts } from "../../src/lib/github.js";

// ---------------------------------------------------------------------------
// extractPrNumber
// ---------------------------------------------------------------------------

describe("extractPrNumber", () => {
  it("should extract PR number from pull_request ref", () => {
    expect(extractPrNumber("pull_request", "refs/pull/42/merge")).toBe(42);
  });

  it("should extract PR number from pull_request_target ref", () => {
    expect(extractPrNumber("pull_request_target", "refs/pull/7/merge")).toBe(7);
  });

  it("should return null for push event", () => {
    expect(extractPrNumber("push", "refs/heads/main")).toBeNull();
  });

  it("should return null when eventName is undefined", () => {
    expect(extractPrNumber(undefined, "refs/pull/1/merge")).toBeNull();
  });

  it("should return null when ref is undefined", () => {
    expect(extractPrNumber("pull_request", undefined)).toBeNull();
  });

  it("should return null when ref does not contain a PR number", () => {
    expect(extractPrNumber("pull_request", "refs/heads/feature")).toBeNull();
  });
});

describe("getDependabotAlerts", () => {
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return data for happy path with pagination", async () => {
    mockFetch
      .mockResolvedValueOnce({
        status: 200,
        json: vi.fn().mockResolvedValue([
          {
            number: 1,
            security_vulnerability: { severity: "high" },
            created_at: "2024-01-01T00:00:00Z",
            url: "url-1",
          },
        ]),
        headers: new Map(),
      } as any)
      .mockResolvedValueOnce({
        status: 200,
        json: vi.fn().mockResolvedValue([]),
        headers: new Map(),
      } as any);

    const token = "valid-token";
    const data = await getDependabotAlerts(token, "org", "repo");
    expect(data).toEqual([
      {
        url: "url-1",
        severity: "high",
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);
  });

  it("should throw an error for missing permissions on 403 status with empty body", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 403,
      text: vi.fn().mockResolvedValue(""),
      headers: new Map(),
    } as any);

    const token = "valid-token";
    await expect(getDependabotAlerts(token, "org", "repo")).rejects.toThrow(
      "GitHub API error: github token requires the vulnerability-alerts permission 403 ",
    );
  });

  it("should throw an error when Dependabot is disabled on 403 status", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 403,
      text: vi.fn().mockResolvedValue(
        "Dependabot alerts are disabled for this repository."
      ),
      headers: new Map(),
    } as any);

    const token = "valid-token";
    await expect(getDependabotAlerts(token, "org", "repo")).rejects.toThrow(
      "GitHub API error: Dependabot alerts are disabled for this repository. 403 Dependabot alerts are disabled for this repository.",
    );
  });

  it("should throw error with error", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 400,
      text: vi.fn().mockResolvedValue("random error"),
      headers: new Map(),
    } as any);

    const token = "valid-token";
    await expect(getDependabotAlerts(token, "org", "repo")).rejects.toThrow(
      "GitHub API error: HTTP 400 random error",
    );
  });
});
