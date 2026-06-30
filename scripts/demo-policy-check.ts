#!/usr/bin/env tsx
/**
 * Demo script that simulates a Dependabot policy check with fake alerts.
 *
 * Usage:
 *   yarn tsx scripts/demo-policy-check.ts [--mode enforce|report] [--blocking-severity critical|high|medium|low]
 * e.g yarn tsx scripts/demo-policy-check.ts --mode enforce --blocking-severity high
 *
 * This patches the GitHub API call so no real token is needed, then runs
 * the evaluator with synthetic alerts that produce both blocking AND
 *Alerts needing attention. It prints the same console output `main.ts`
 * would produce and renders the PR comment markdown to stdout.
 */

import {
  DependabotPolicyEvaluator,
  type DependabotAlert,
} from "../src/lib/dependabotAlertsFetcher.js";
import {
  buildCommentBody,
  type PolicyStatus,
} from "../src/lib/comment.js";
import { type BlockingSeverity, SEVERITY_RANK } from "../src/lib/policyConfig.js";

// ---------------------------------------------------------------
// Fake alerts — ages chosen to exceed the default thresholds so
// that we get violations at every severity level.
// ---------------------------------------------------------------

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const FAKE_ALERTS: DependabotAlert[] = [
  // Critical — threshold 5 days
  { url: "https://github.com/demo-org/demo-repo/security/dependabot/1",  severity: "critical", created_at: daysAgo(10), number: 1,  fix_available: true  },
  { url: "https://github.com/demo-org/demo-repo/security/dependabot/2",  severity: "critical", created_at: daysAgo(3),  number: 2,  fix_available: true  }, // within threshold
  // High — threshold 20 days
  { url: "https://github.com/demo-org/demo-repo/security/dependabot/3",  severity: "high",     created_at: daysAgo(25), number: 3,  fix_available: true  },
  { url: "https://github.com/demo-org/demo-repo/security/dependabot/4",  severity: "high",     created_at: daysAgo(30), number: 4,  fix_available: true  },
  // Medium — threshold 40 days
  { url: "https://github.com/demo-org/demo-repo/security/dependabot/5",  severity: "medium",   created_at: daysAgo(50), number: 5,  fix_available: true  },
  // Low — threshold 100 days
  { url: "https://github.com/demo-org/demo-repo/security/dependabot/6",  severity: "low",      created_at: daysAgo(120),number: 6,  fix_available: true  },
  // No fix available — should be ignored from evaluation
  { url: "https://github.com/demo-org/demo-repo/security/dependabot/7",  severity: "critical", created_at: daysAgo(15), number: 7,  fix_available: false },
];

// ---------------------------------------------------------------
// Minimal @actions/core shim — prints to console
// ---------------------------------------------------------------

const LOG_STYLE = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

// ---------------------------------------------------------------
// Parse CLI flags
// ---------------------------------------------------------------

function parseArgs(): { mode: string; blockingSeverity: BlockingSeverity } {
  const args = process.argv.slice(2);
  let mode = "enforce";
  let blockingSeverity: BlockingSeverity = "critical";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mode" && args[i + 1]) {
      mode = args[++i];
    } else if (args[i] === "--blocking-severity" && args[i + 1]) {
      blockingSeverity = args[++i] as BlockingSeverity;
    }
  }

  if (mode !== "enforce" && mode !== "report") {
    console.error(`mode must be "enforce" or "report", got "${mode}"`);
    process.exit(1);
  }
  if (!(blockingSeverity in SEVERITY_RANK)) {
    console.error(`blocking-severity must be one of "critical", "high", "medium", "low", got "${blockingSeverity}"`);
    process.exit(1);
  }
  return { mode, blockingSeverity };
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------

async function main(): Promise<void> {
  const { mode, blockingSeverity } = parseArgs();
  const repo = "demo-org/demo-repo";

  console.log(
    `\n${LOG_STYLE.bold}${LOG_STYLE.cyan}=== Dependabot Policy Check Demo ===${LOG_STYLE.reset}`,
  );
  console.log(`  repo:               ${repo}`);
  console.log(`  mode:               ${mode}`);
  console.log(`  blocking-severity:  ${blockingSeverity}`);
  console.log(`  fake alerts:        ${FAKE_ALERTS.length}`);
  console.log();

  // Subclass that overrides fetchOpenAlerts to return fake data,
  // so evaluateDependabotResults runs the full production path
  // without hitting the real GitHub API.
  class DemoEvaluator extends DependabotPolicyEvaluator {
    override async fetchOpenAlerts(): Promise<DependabotAlert[]> {
      return FAKE_ALERTS;
    }
  }

  const evaluator = new DemoEvaluator("fake-token", repo);
  const policyResponse = await evaluator.evaluateDependabotResults(mode, blockingSeverity);

  // ---------------------------------------------------------------
  // Console output (mirrors main.ts behaviour)
  // ---------------------------------------------------------------

  const passed = mode === "report" ? true : policyResponse.pipelinePasses;
  let statusLabel: PolicyStatus = passed ? "passed" : "failed";

  if (!passed) {
    console.log(
      `${LOG_STYLE.bold}${LOG_STYLE.red}Policy check failed:${LOG_STYLE.reset}`,
    );
    console.log(JSON.stringify(policyResponse.summary, null, 2));
  } else if (passed && policyResponse.message) {
    statusLabel = "passed";
    console.log(
      `${LOG_STYLE.bold}${LOG_STYLE.yellow}Policy check message:${LOG_STYLE.reset} ${policyResponse.message}`,
    );
    console.log(JSON.stringify(policyResponse.summary, null, 2));
  } else {
    console.log(
      `${LOG_STYLE.bold}${LOG_STYLE.green}Policy check passed.${LOG_STYLE.reset}`,
    );
  }

  // ---------------------------------------------------------------
  // Render the PR comment (markdown) to stdout
  // ---------------------------------------------------------------

  const alertsUrl = `https://github.com/${repo}/security/dependabot`;
  const commentMarkdown = buildCommentBody(
    statusLabel,
    policyResponse,
    mode,
    alertsUrl,
    blockingSeverity,
  );

  console.log(
    `\n${LOG_STYLE.bold}${LOG_STYLE.cyan}=== PR Comment (Markdown) ===${LOG_STYLE.reset}\n`,
  );
  console.log(commentMarkdown);
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
