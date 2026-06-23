import { getDependabotAlerts } from "./github.js";
import * as core from "@actions/core";

import { type PolicyThresholds } from "./policyConfig.js";
import thresholds from "./policyConfig.js";

const RECOGNISED_SEVERITIES: ReadonlySet<string> = new Set([
  "critical",
  "high",
  "medium",
  "low",
]);

export interface PolicyResponse {
  pipelinePasses: boolean;
  mode: string;
  repository: string;
  summary: Record<string, number | string | null>;
  findings: {
    violations: {
      critical: AlertViolation[] | null;
      high: AlertViolation[] | null;
      medium: AlertViolation[] | null;
      low: AlertViolation[] | null;
    };
  };
  message?: string;
}

export interface DependabotAlert {
  severity: string;
  url: string;
  created_at: string;
}

export interface AlertViolation {
  url: string;
  age: string;
}


export interface PolicyEvaluationResult {
  totalOpenAlerts: number;
  violatingAlerts: number;
  oldestAlert: string;
  violations: {
    critical: AlertViolation[];
    high: AlertViolation[];
    medium: AlertViolation[];
    low: AlertViolation[];
  };
}

export class DependabotPolicyEvaluator {
  private readonly token: string;
  private readonly repo: string;
  private readonly owner: string;

  constructor(githubToken: string, repo: string) {
    const [owner, repoName] = repo.split("/");
    this.owner = owner;
    this.repo = repoName;
    this.token = githubToken;
  }

  /**
   * Fetch all open Dependabot alerts for a repository
   * @param owner Repository owner (organization)
   * @param repo Repository name
   * @returns Discriminated union indicating whether Dependabot is enabled and, if so, the open alerts
   */
  async fetchOpenAlerts(): Promise<DependabotAlert[]> {
    try {
      const alerts = await getDependabotAlerts(this.token, this.owner, this.repo);

      console.info("Fetched Dependabot alerts", {
        owner: this.owner,
        repo: this.repo,
        totalAlerts: alerts.length,
      });

      return alerts;
    } catch (error: unknown) {
      const status =
        error instanceof Error && "status" in error
          ? (error as { status: number }).status
          : undefined;
      const message = error instanceof Error ? error.message : String(error);

      console.error("Failed to fetch Dependabot alerts", {
        owner: this.owner,
        repo: this.repo,
        error: message,
        status,
      });
      throw error;
    }
  }

  /**
   * Calculate age of an alert in days
   */
  private calculateAlertAgeDays(createdAt: string): number {
    const created = new Date(createdAt);
    const now = new Date();
    const ageMs = now.getTime() - created.getTime();
    return Math.floor(ageMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Format age in human-readable format
   */
  private formatAge(days: number): string {
    if (days === 0) return "today";
    if (days === 1) return "1 day";
    return `${days} days`;
  }

  /**
   * Evaluate alerts against policy thresholds
   */
  evaluateAlerts(
    alerts: DependabotAlert[],
    thresholds: PolicyThresholds,
  ): PolicyEvaluationResult {
    const violations: PolicyEvaluationResult["violations"] = {
      critical: [],
      high: [],
      medium: [],
      low: [],
    };

    let oldestAgeDays = 0;

    for (const alert of alerts) {
      const rawSeverity = alert.severity.toLowerCase();
      const ageDays = this.calculateAlertAgeDays(alert.created_at);

      // Track oldest alert across all severities (including unrecognised)
      if (ageDays > oldestAgeDays) {
        oldestAgeDays = ageDays;
      }

      // Only evaluate against thresholds for recognised severities
      if (!RECOGNISED_SEVERITIES.has(rawSeverity)) {
        console.warn(
          "Unrecognised alert severity — alert excluded from policy evaluation",
          {
            alert: alert.url
          },
        );
        continue;
      }

      const severity = rawSeverity as keyof PolicyThresholds;
      const threshold = thresholds[severity];

      // Check if alert exceeds threshold
      if (ageDays > threshold.maxAgeDays) {
        violations[severity].push({
          url: alert.url,
          age: this.formatAge(ageDays),
        });
      }
    }

    const violatingAlerts =
      violations.critical.length +
      violations.high.length +
      violations.medium.length +
      violations.low.length;

    return {
      totalOpenAlerts: alerts.length,
      violatingAlerts,
      oldestAlert: this.formatAge(oldestAgeDays),
      violations,
    };
  }

  async evaluateDependabotResults(mode: string): Promise<PolicyResponse> {
    // Fetch open alerts and evaluate against policy thresholds
    let alerts: DependabotAlert[]
    try {
      alerts = await this.fetchOpenAlerts();
    }
    catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof Error && message.includes("Dependabot alerts are disabled for this repository.")) {
        core.info(`Dependabot alerts are disabled for this repository: ${this.repo}`);
        return {
          pipelinePasses: true,
          mode,
          repository: this.repo,
          summary: {
            totalOpenAlerts: null,
            violatingAlerts: null,
            oldestAlert: null,
          },
          findings: {
            violations: {
              critical: null,
              high: null,
              medium: null,
              low: null,
            },
          },
          message: "Dependabot alerts are disabled for this repository.",
        };
      }
      else {
        core.error(`Failed to fetch Dependabot alerts for ${this.repo}: ${message}`);
        throw error;
      }
    }
    core.info(`Fetched Dependabot alerts, with total count: ${alerts.length}`);

    const evaluation = this.evaluateAlerts(alerts, thresholds);

    core.info("Dependabot policy evaluation result finished");

    const pipelinePasses =
      mode === "report" || evaluation.violatingAlerts === 0;
    const result: PolicyResponse = {
      pipelinePasses,
      mode,
      repository: this.repo,
      summary: {
        totalOpenAlerts: evaluation.totalOpenAlerts,
        violatingAlerts: evaluation.violatingAlerts,
        oldestAlert: evaluation.oldestAlert,
      },
      findings: {
        violations: evaluation.violations,
      },
    };


    if (pipelinePasses && evaluation.violatingAlerts > 0) {
      result.message = `Dependabot policy check passed in report mode, but ${evaluation.violatingAlerts} alert(s) exceed the defined thresholds.`;
    }
    return result;
}
}
