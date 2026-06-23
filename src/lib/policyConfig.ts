export interface PolicyThresholds {
  critical: { maxAgeDays: number; description: string };
  high: { maxAgeDays: number; description: string };
  medium: { maxAgeDays: number; description: string };
  low: { maxAgeDays: number; description: string };
}

const thresholds = {
      critical: {
        maxAgeDays: 5,
        description: "Critical alerts must be addressed within 10 days",
      },
      high: {
        maxAgeDays: 1000,
        description: "High alerts must be addressed within 1000 days",
      },
      medium: {
        maxAgeDays: 1000,
        description: "Medium alerts must be addressed within 1000 days",
      },
      low: {
        maxAgeDays: 1000,
        description: "Low alerts must be addressed within 1000 days",
      },
    };

export default thresholds;
