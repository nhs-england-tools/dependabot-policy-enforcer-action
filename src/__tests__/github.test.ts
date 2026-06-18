import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  extractPrNumber,
  graphqlQuery,
} from "../../src/lib/github.js";

// Mock fetch
const mockFetch = vi.fn(global.fetch);

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

describe("graphqlQuery", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return data for a valid query", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
          data: {
            repository: {
              vulnerabilityAlerts: {
                nodes: [
                  {
                    number: 1,
                    securityVulnerability: { severity: "high" },
                    createdAt: "2024-01-01T00:00:00Z",
                  },
                ],
              },
            },
          },
      }),
    );
    const token = "valid-token";
    const query = `valid query`;

    const data = await graphqlQuery(token, query);
    expect(data).toEqual([
                  {
                    number: 1,
                    securityVulnerability: { severity: "high" },
                    createdAt: "2024-01-01T00:00:00Z",
                  },
                ]);

  });

  it("should throw an error errors in returned data", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
          errors: "Some GraphQL error",
      }),
    );
    const token = "valid-token";
    const invalidQuery = `
      query {
        invalidField
      }
    `;

    await expect(graphqlQuery(token, invalidQuery)).rejects.toThrow(
      "GitHub API GraphQL errors: \"Some GraphQL error\"",
    );
  });

  it("should throw an if response is not ok", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
          status: 400,
      }),
    );
    const token = "valid-token";
    const invalidQuery = `
      query {
        invalidField
      }
    `;

    await expect(graphqlQuery(token, invalidQuery)).rejects.toThrow(
      "GitHub API error: HTTP 400 ",
    );
  });
});
