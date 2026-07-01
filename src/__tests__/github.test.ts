import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  extractPrNumber,
  getDependabotAlerts,
  isFixAvailable,
} from "../../src/lib/github.js";

vi.mock("@actions/core", () => ({
  info: vi.fn(),
}));

import * as core from "@actions/core";

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
    vi.mocked(core.info).mockClear();
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
            security_vulnerability: {
              severity: "high",
              first_patched_version: { identifier: "1.0.1" },
            },
            created_at: "2024-01-01T00:00:00Z",
            url: "url-1",
          },
        ]),
        headers: new Map([
          ["link", '<https://api.github.com/page2>; rel="next"'],
        ]),
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
        number: 1,
        severity: "high",
        created_at: "2024-01-01T00:00:00Z",
        fix_available: true,
      },
    ]);
    expect(core.info).not.toHaveBeenCalledWith(
      expect.stringContaining("withdrawn"),
    );
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
      text: vi
        .fn()
        .mockResolvedValue(
          "Dependabot alerts are disabled for this repository.",
        ),
      headers: new Map(),
    } as any);

    const token = "valid-token";
    await expect(getDependabotAlerts(token, "org", "repo")).rejects.toThrow(
      "GitHub API error: Dependabot alerts are disabled for this repository. 403 Dependabot alerts are disabled for this repository.",
    );
  });

  it("should filter out alerts with withdrawn security advisories", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      json: vi.fn().mockResolvedValue([
        {
          number: 1,
          security_vulnerability: {
            severity: "high",
            first_patched_version: { identifier: "1.0.1" },
          },
          security_advisory: { withdrawn_at: "2024-06-01T00:00:00Z" },
          created_at: "2024-01-01T00:00:00Z",
          url: "url-1",
        },
        {
          number: 2,
          security_vulnerability: {
            severity: "medium",
            first_patched_version: null,
          },
          security_advisory: { withdrawn_at: null },
          created_at: "2024-01-02T00:00:00Z",
          url: "url-2",
        },
        {
          number: 3,
          security_vulnerability: {
            severity: "low",
            first_patched_version: null,
          },
          security_advisory: {},
          created_at: "2024-01-03T00:00:00Z",
          url: "url-3",
        },
      ]),
      headers: new Map(),
    } as any);

    const data = await getDependabotAlerts("valid-token", "org", "repo");
    expect(data).toHaveLength(2);
    expect(data.map((a: any) => a.number)).toEqual([2, 3]);
    expect(core.info).toHaveBeenCalledWith(
      "Skipping 1 alert(s) with withdrawn security advisories: #1",
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

// ---------------------------------------------------------------------------
// isFixAvailable
// ---------------------------------------------------------------------------
describe("isFixAvailable", () => {
  it("should return true if alert has security_vulnerability.first_patched_version", () => {
    const alert = {
      dependency: {
        package: { ecosystem: "npm", name: "lodash" },
      },
      security_vulnerability: {
        first_patched_version: { identifier: "1.0.1" },
      },
    };
    expect(isFixAvailable(alert)).toBe(true);
  });

  it("should return false when security_vulnerability.first_patched_version is null", () => {
    const alert = {
      dependency: {
        package: { ecosystem: "npm", name: "lodash" },
      },
      security_vulnerability: {
        first_patched_version: null,
      }
    };
    expect(isFixAvailable(alert)).toBe(false);
  });

  it("should return false when security_vulnerability and security_advisory is absent", () => {
    const alert = {};
    expect(isFixAvailable(alert)).toBe(false);
  });
});
