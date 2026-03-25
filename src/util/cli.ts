import { spawn } from "node:child_process";
import * as core from "@actions/core";
import type { CLIResult } from "../analysis/types.js";

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

interface CLIOptions {
  /** Extra environment variables to pass to the CLI process. */
  env?: Record<string, string>;
  /** Working directory for the CLI process. */
  cwd?: string;
  /** Timeout in milliseconds. Defaults to 300 000 (5 min). */
  timeout?: number;
  /** If true, attempt to parse stdout as JSON. */
  parseJson?: boolean;
}

/**
 * Spawn the `altimate-code` CLI and capture its output.
 *
 * Returns a structured result with exit code, stdout, stderr, and optionally
 * parsed JSON. Throws only on spawn failure or timeout — a non-zero exit code
 * is returned in the result so callers can decide how to handle it.
 */
export async function runCLI(args: string[], options: CLIOptions = {}): Promise<CLIResult> {
  const { env: extraEnv = {}, cwd, timeout = DEFAULT_TIMEOUT_MS, parseJson = false } = options;

  const command = "altimate-code";
  core.debug(`Running CLI: ${command} ${args.join(" ")}`);

  return new Promise<CLIResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      // Give it a moment to die gracefully, then force-kill
      setTimeout(() => child.kill("SIGKILL"), 5000);
      reject(
        new Error(`altimate-code CLI timed out after ${timeout}ms: ${command} ${args.join(" ")}`),
      );
    }, timeout);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn altimate-code CLI: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      const exitCode = code ?? 1;

      if (stderr.trim()) {
        core.debug(`CLI stderr: ${stderr.trim()}`);
      }

      let json: unknown;
      if (parseJson && stdout.trim()) {
        try {
          json = JSON.parse(stdout.trim());
        } catch {
          core.debug("CLI stdout was not valid JSON — returning raw text");
        }
      }

      resolve({ exitCode, stdout, stderr, json });
    });
  });
}

/**
 * Run the CLI and require a zero exit code. Throws an error with stderr
 * context on non-zero exit.
 */
export async function runCLIOrThrow(args: string[], options: CLIOptions = {}): Promise<CLIResult> {
  const result = await runCLI(args, options);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "(no output)";
    throw new Error(`altimate-code exited with code ${result.exitCode}: ${detail}`);
  }
  return result;
}
