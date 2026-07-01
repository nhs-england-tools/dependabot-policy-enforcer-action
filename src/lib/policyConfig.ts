export interface PolicyThresholds {
  critical: { maxAgeDays: number; description: string };
  high: { maxAgeDays: number; description: string };
  medium: { maxAgeDays: number; description: string };
  low: { maxAgeDays: number; description: string };
}

const thresholds = {
      critical: {
        maxAgeDays: 5,
        description: "Critical alerts must be addressed within 5 days",
      },
      high: {
        maxAgeDays: 15,
        description: "High alerts must be addressed within 15 days",
      },
      medium: {
        maxAgeDays: 30,
        description: "Medium alerts must be addressed within 30 days",
      },
      low: {
        maxAgeDays: 40,
        description: "Low alerts must be addressed within 40 days",
      },
    };

export default thresholds;

export type Severity = "critical" | "high" | "medium" | "low";

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function isBlockingSeverity(
  severity: Severity,
  blockingSeverity: Severity,
): boolean {
  const rank = SEVERITY_RANK[severity as Severity];
  if (rank === undefined) return false;
  return rank >= SEVERITY_RANK[blockingSeverity];
}
