/**
 * GitHub Action entry point for the Dependabot Policy Enforcer.
 *
 * Reads action inputs, generates a signed HMAC-SHA256 request,
 * calls the policy enforcer API, and sets outputs / fails the
 * workflow check based on the response.
 */

import * as core from "@actions/core";
import { sendPolicyRequest } from "./lib/request.js";
import { postPrComment, extractPrNumber, getChangedFiles, isPackageFile } from "./lib/comment.js";

const LOG_STYLE = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function validateUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export async function run(): Promise<void> {
  try {
    // ---------------------------------------------------------------
    // 1. Read inputs
    // ---------------------------------------------------------------
    const secret = core.getInput("secret");
    const endpoint = core.getInput("api-endpoint");
    const timeoutMs = Number.parseInt(
      core.getInput("timeout-ms") || "10000",
      10,
    );
    const repo = process.env.GITHUB_REPOSITORY ?? "";
    const mode = (core.getInput("mode") || "enforce").trim().toLowerCase();

    // ---------------------------------------------------------------
    // 2. Mask secret immediately
    // ---------------------------------------------------------------
    core.setSecret(secret);

    // ---------------------------------------------------------------
    // 3. Validate inputs
    // ---------------------------------------------------------------
    if (!secret) {
      core.setFailed(
        "secret input is required. " +
          "Store it as the DEPENDABOT_ENFORCER_SECRET repository secret and reference it in your workflow.",
      );
      return;
    }

    if (!endpoint) {
      core.setFailed(
        "api-endpoint input is required. " +
          "Set it as an organisation or repository variable (vars.DEPENDABOT_ENFORCER_API_ENDPOINT).",
      );
      return;
    }

    if (!validateUrl(endpoint)) {
      core.setFailed(
        `api-endpoint value is not a valid URL: "${endpoint}". ` +
          "Provide a fully-qualified URL including the scheme (e.g. https://api.example.com/check).",
      );
      return;
    }

    if (!repo) {
      core.setFailed(
        "GITHUB_REPOSITORY environment variable is not set. " +
          "This action must run inside a GitHub Actions workflow.",
      );
      return;
    }

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      core.setFailed(
        `timeout-ms must be a positive number, got "${core.getInput("timeout-ms")}".`,
      );
      return;
    }

    if (mode !== "enforce" && mode !== "report") {
      core.setFailed(
        `mode must be either "enforce" or "report", got "${core.getInput("mode")}".`,
      );
      return;
    }

    // ---------------------------------------------------------------
    // 4. Read optional github-token and mask it immediately
    // ---------------------------------------------------------------
    const githubToken = core.getInput("github-token");
    if (githubToken) {
      core.setSecret(githubToken);
    }

    // ---------------------------------------------------------------
    // 5. Send signed request
    // ---------------------------------------------------------------
    core.info(`Checking Dependabot policy for ${repo}…`);

    const result = await sendPolicyRequest({
      repo,
      secret,
      endpoint,
      mode,
      timeoutMs,
    });

    // ---------------------------------------------------------------
    // 6. Set outputs
    // ---------------------------------------------------------------
    core.setOutput("status-code", result.statusCode.toString());
    core.setOutput("response-body", result.body);

    if (result.statusCode >= 200 && result.statusCode < 300) {
      const body = JSON.parse(result.body);
      const prNumber = extractPrNumber(
        process.env.GITHUB_EVENT_NAME,
        process.env.GITHUB_REF,
      );
      let passed = mode === "report" ? true : body.pipelinePasses === true;

      // ---------------------------------------------------------------
      // 6a. Package-file exemption (enforce mode only)
      //
      // If the PR changes package or dependency management files, assume
      // it is attempting to fix a vulnerability. Rather than failing the
      // workflow, print the policy summary and let the PR proceed.

      // The check requires a github-token and a valid PR number; if
      // either is absent we skip checking if package files have been
      // changed (fail-safe: still fails).
      // If the API call to Github to fetch PR files fails, a warning is emitted a
      // and the original passed=false is preserved (fail-safe default).
      // ---------------------------------------------------------------

      if (mode === "enforce" && !passed && githubToken && prNumber !== null) {
        try {
          const [owner, repoName] = repo.split("/");
          const files = await getChangedFiles(githubToken, owner, repoName, prNumber);
          if (files.some(isPackageFile)) {
            passed = true;
            core.info(
              `${LOG_STYLE.bold}${LOG_STYLE.yellow}This PR changes dependency package files. Allowing step to succeed.${LOG_STYLE.reset}. \n` +
              `Please review the policy summary and ensure the PR is fixing a vulnerability or updating dependencies appropriately. \n` +
              `${LOG_STYLE.bold}Summary:${LOG_STYLE.reset} ${JSON.stringify(body.summary, null, 2)}`
            );
          }
        } catch (filesError) {
          const filesMsg = filesError instanceof Error ? filesError.message : String(filesError);
          core.warning(`Failed to check PR changed files: ${filesMsg}`);
        }
      }

      if (!passed) {
        core.setFailed(
          `${LOG_STYLE.bold}${LOG_STYLE.red}Policy check failed:${LOG_STYLE.reset} \n` +
            `${LOG_STYLE.bold}Summary:${LOG_STYLE.reset} ${JSON.stringify(body.summary, null, 2)}`,
        );
      } else if (passed && body.message) { // Message present in report mode
        core.info(
          `${LOG_STYLE.bold}${LOG_STYLE.yellow}Policy check message:${LOG_STYLE.reset} ${body.message} \n` +
            `${LOG_STYLE.bold}Summary:${LOG_STYLE.reset} ${JSON.stringify(body.summary, null, 2)}`
        );
      } else {
        core.info(
          `${LOG_STYLE.bold}${LOG_STYLE.green}Policy check passed (${result.statusCode}) in ${result.durationMs}ms.${LOG_STYLE.reset}`,
        );
      }

      // Post a PR comment if the github-token is provided, regardless of pass/fail, but only for "pull_request" events
      if (githubToken) {
        try {
          await postPrComment(githubToken, repo, prNumber, body, passed, mode);
        } catch (commentError) {
          const commentMsg =
            commentError instanceof Error
              ? commentError.message
              : String(commentError);
          core.warning(`Failed to post PR comment: ${commentMsg}`);
        }
      }
    } else {
      // Non-2xx responses indicate an API or configuration error (e.g. invalid
      // secret, unreachable endpoint). These are always fatal regardless of
      // mode — report mode only suppresses policy violations, not infrastructure
      // failures.
      core.setFailed(
        `${LOG_STYLE.bold}${LOG_STYLE.red}Policy check failed with status ${result.statusCode} (${result.durationMs}ms).${LOG_STYLE.reset}\n` +
          `${LOG_STYLE.bold}Response:${LOG_STYLE.reset} ${result.body}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(
      `${LOG_STYLE.bold}${LOG_STYLE.red}Unexpected error:${LOG_STYLE.reset} ${message}`,
    );
  }
}

run();
