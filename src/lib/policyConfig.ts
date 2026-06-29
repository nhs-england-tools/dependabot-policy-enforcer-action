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
        maxAgeDays: 20,
        description: "High alerts must be addressed within 20 days",
      },
      medium: {
        maxAgeDays: 40,
        description: "Medium alerts must be addressed within 40 days",
      },
      low: {
        maxAgeDays: 100,
        description: "Low alerts must be addressed within 100 days",
      },
    };

export default thresholds;

export type BlockingSeverity = "critical" | "high" | "medium" | "low"; // to do rename to severity

export const SEVERITY_RANK: Record<BlockingSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function isBlockingSeverity(
  severity: string,
  blockingSeverity: BlockingSeverity,
): boolean {
  const rank = SEVERITY_RANK[severity as BlockingSeverity];
  if (rank === undefined) return false;
  return rank >= SEVERITY_RANK[blockingSeverity];
}
