import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DependabotPolicyEvaluator,
  type DependabotAlert,
  type PolicyThresholds,
} from "../../src/lib/dependabotAlertsFetcher.js";
import { graphqlQuery, isDependabotEnabled } from "../../src/lib/github.js";

vi.mock("../../src/lib/github.js", () => ({
  isDependabotEnabled: vi.fn(),
  graphqlQuery: vi.fn(),
}));

const mockIsDependabotEnabled = vi.mocked(isDependabotEnabled);
const mockGraphqlQuery = vi.mocked(graphqlQuery);

function makeAlert(
  number: number,
  severity: string,
  createdAt: string,
): DependabotAlert {
  return {
    number,
    securityVulnerability: {
      severity,
    },
    createdAt: createdAt,
  };
}

const thresholds: PolicyThresholds = {
  critical: { maxAgeDays: 7, description: "Critical" },
  high: { maxAgeDays: 14, description: "High" },
  medium: { maxAgeDays: 30, description: "Medium" },
  low: { maxAgeDays: 60, description: "Low" },
};

describe("DependabotPolicyEvaluator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchOpenAlerts", () => {
    it("calls graphqlQuery with token, query and repo variables", async () => {
      const evaluator = new DependabotPolicyEvaluator("token-123", "org/repo");
      const alerts = [makeAlert(1, "critical", "2026-06-01T00:00:00.000Z")];
      mockGraphqlQuery.mockResolvedValueOnce(alerts);

      const result = await evaluator.fetchOpenAlerts();

      expect(mockGraphqlQuery).toHaveBeenCalledWith(
        "token-123",
        expect.stringContaining("vulnerabilityAlerts(first: 100, states: OPEN)"),
        { owner: "org", repo: "repo" },
      );
      expect(result).toEqual(alerts);
    });

    it("rethrows graphql errors", async () => {
      const evaluator = new DependabotPolicyEvaluator("token-123", "org/repo");
      mockGraphqlQuery.mockRejectedValueOnce(new Error("GraphQL failed"));

      await expect(evaluator.fetchOpenAlerts()).rejects.toThrow("GraphQL failed");
    });
  });

  describe("evaluateAlerts", () => {
    it("calculates violations against thresholds", () => {
      const now = new Date();
      const oldCritical = new Date(
        now.getTime() - 10 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const freshHigh = new Date(
        now.getTime() - 2 * 24 * 60 * 60 * 1000,
      ).toISOString();

      const evaluator = new DependabotPolicyEvaluator("token-123", "org/repo");
      const result = evaluator.evaluateAlerts(
        [makeAlert(1, "critical", oldCritical), makeAlert(2, "high", freshHigh)],
        thresholds,
      );

      expect(result.totalOpenAlerts).toBe(2);
      expect(result.violatingAlerts).toBe(1);
      expect(result.violations.critical).toHaveLength(1);
      expect(result.violations.high).toHaveLength(0);
    });

    it("skips unrecognised severities", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const now = new Date();
      const old = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();

      const evaluator = new DependabotPolicyEvaluator("token-123", "org/repo");
      const result = evaluator.evaluateAlerts(
        [makeAlert(1, "unknown", old), makeAlert(2, "critical", old)],
        thresholds,
      );

      expect(result.totalOpenAlerts).toBe(2);
      expect(result.violatingAlerts).toBe(1);
      expect(warnSpy).toHaveBeenCalledWith(
        "Unrecognised alert severity — alert excluded from policy evaluation",
        expect.objectContaining({
          alert: "https://github.com/org/repo/security/dependabot/1",
        }),
      );

      warnSpy.mockRestore();
    });
  });

  describe("evaluateDependabotResults", () => {

    it("adds a message in report mode when violations exist", async () => {
      const evaluator = new DependabotPolicyEvaluator("token-123", "org/repo");
      const oldCritical = new Date(
        Date.now() - 15 * 24 * 60 * 60 * 1000,
      ).toISOString();

      mockIsDependabotEnabled.mockResolvedValueOnce(true);
      mockGraphqlQuery.mockResolvedValueOnce([
        makeAlert(1, "critical", oldCritical),
      ]);

      const result = await evaluator.evaluateDependabotResults("report");

      expect(result.pipelinePasses).toBe(true);
      expect(result.summary.violatingAlerts).toBe(1);
      expect(result.message).toContain("passed in report mode");
    });

    it("fails pipeline in enforce mode when violations exist", async () => {
      const evaluator = new DependabotPolicyEvaluator("token-123", "org/repo");
      const oldCritical = new Date(
        Date.now() - 20 * 24 * 60 * 60 * 1000,
      ).toISOString();

      mockIsDependabotEnabled.mockResolvedValueOnce(true);
      mockGraphqlQuery.mockResolvedValueOnce([makeAlert(3, "critical", oldCritical)]);

      const result = await evaluator.evaluateDependabotResults("enforce");

      expect(result.pipelinePasses).toBe(false);
      expect(result.summary.violatingAlerts).toBe(1);
      expect(result.message).toBeUndefined();
    });
  });
});
