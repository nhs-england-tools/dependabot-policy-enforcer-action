import { beforeEach, describe, expect, it, vi } from "vitest";
import * as core from "@actions/core";
import {
  DependabotPolicyEvaluator,
  type DependabotAlert,
} from "../../src/lib/dependabotAlertsFetcher.js";
import type { PolicyThresholds } from "../../src/lib/policyConfig.js";
import { getDependabotAlerts } from "../../src/lib/github.js";

vi.mock("../../src/lib/github.js", () => ({
  getDependabotAlerts: vi.fn(),
}));

vi.mock("@actions/core", () => ({
  info: vi.fn(),
  error: vi.fn(),
}));

const mockgetDependabotAlerts = vi.mocked(getDependabotAlerts);

function makeAlert(
  url: string,
  severity: string,
  createdAt: string,
  number: number = 1,
  fixAvailable: boolean = true
): DependabotAlert {
  return {
    url,
    severity,
    created_at: createdAt,
    number: number,
    fix_available: fixAvailable,
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
    it("calls getDependabotAlerts with token, query and repo variables", async () => {
      const evaluator = new DependabotPolicyEvaluator("token-123", "org/repo");
      const alerts = [makeAlert("url-1", "critical", "2026-06-01T00:00:00.000Z")];
      mockgetDependabotAlerts.mockResolvedValueOnce(alerts);

      const result = await evaluator.fetchOpenAlerts();

      expect(mockgetDependabotAlerts).toHaveBeenCalledWith(
        "token-123",
        "org", "repo"
      );
      expect(result).toEqual(alerts);
    });

    it("rethrows graphql errors", async () => {
      const evaluator = new DependabotPolicyEvaluator("token-123", "org/repo");
      mockgetDependabotAlerts.mockRejectedValueOnce(new Error("GraphQL failed"));

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
        [makeAlert("url-1", "critical", oldCritical, 1), makeAlert("url-2", "high", freshHigh, 2)],
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
        [makeAlert("url-1", "unknown", old, 1), makeAlert("url-2", "critical", old, 2)],
        thresholds,
      );

      expect(result.totalOpenAlerts).toBe(2);
      expect(result.violatingAlerts).toBe(1);
      expect(warnSpy).toHaveBeenCalledWith(
        "Unrecognised alert severity — alert excluded from policy evaluation",
        expect.objectContaining({
          alert: "url-1",
        }),
      );

      warnSpy.mockRestore();
    });

    it("skips evaluating alerts that do not have a fix available", () => {
      const now = new Date();
      const old = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();

      const evaluator = new DependabotPolicyEvaluator("token-123", "org/repo");
      const result = evaluator.evaluateAlerts(
        [makeAlert("url-1", "high", old, 1, true), makeAlert("url-2", "critical", old, 2, false)],
        thresholds,
      );

      expect(result.totalOpenAlerts).toBe(2);
      expect(result.violatingAlerts).toBe(1);
      expect(result.violations.critical).toHaveLength(0);
      expect(result.violations.high).toHaveLength(1);

      expect(core.info).toHaveBeenCalledWith(
        "1 alerts found with no fix available. These alerts are ignored in the policy evaluation. Alerts: url-2"
      );
    });

  });

  describe("evaluateDependabotResults", () => {

    it("adds a message in report mode when violations exist", async () => {
      const evaluator = new DependabotPolicyEvaluator("token-123", "org/repo");
      const oldCritical = new Date(
        Date.now() - 15 * 24 * 60 * 60 * 1000,
      ).toISOString();

      mockgetDependabotAlerts.mockResolvedValueOnce([
        makeAlert("url-1", "critical", oldCritical),
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

      mockgetDependabotAlerts.mockResolvedValueOnce([makeAlert("url-1", "critical", oldCritical)]);

      const result = await evaluator.evaluateDependabotResults("enforce");

      expect(result.pipelinePasses).toBe(false);
      expect(result.summary.violatingAlerts).toBe(1);
      expect(result.message).toBeUndefined();
    });

    it("handles disabled Dependabot alerts gracefully", async () => {
      const evaluator = new DependabotPolicyEvaluator("token-123", "org/repo");
      mockgetDependabotAlerts.mockRejectedValueOnce(new Error("Dependabot alerts are disabled for this repository."));

      const result = await evaluator.evaluateDependabotResults("enforce");

      expect(result.pipelinePasses).toBe(true);
      expect(result.summary.totalOpenAlerts).toBeNull();
      expect(result.summary.violatingAlerts).toBeNull();
    });

    it("shows 0 for totalOpenAlerts and violatingAlerts when there are no alerts", async () => {
      const evaluator = new DependabotPolicyEvaluator("token-123", "org/repo");
      mockgetDependabotAlerts.mockResolvedValueOnce([]);

      const result = await evaluator.evaluateDependabotResults("enforce");

      expect(result.pipelinePasses).toBe(true);
      expect(result.summary.totalOpenAlerts).toBe(0);
      expect(result.summary.violatingAlerts).toBe(0);
    });
  });
});

