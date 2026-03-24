import { spawn } from "node:child_process";
import { resolve } from "node:path";

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  json?: unknown;
  timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 60_000; // 1 minute for tests

/**
 * Check if the altimate-code CLI is available on PATH.
 */
export async function checkCLIAvailable(): Promise<boolean> {
  try {
    const result = await runCLI(["--version"], { timeout: 10_000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Run the altimate-code CLI in a subprocess and capture output.
 */
export async function runCLI(
  args: string[],
  options: {
    env?: Record<string, string>;
    cwd?: string;
    timeout?: number;
  } = {},
): Promise<RunResult> {
  const { env: extraEnv = {}, cwd, timeout = DEFAULT_TIMEOUT_MS } = options;

  return new Promise<RunResult>((resolve_, reject) => {
    const child = spawn("altimate-code", args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000);
    }, timeout);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn altimate-code: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      const exitCode = code ?? 1;

      let json: unknown;
      try {
        if (stdout.trim()) json = JSON.parse(stdout.trim());
      } catch {
        // not JSON, that's fine
      }

      resolve_({ exitCode, stdout, stderr, json, timedOut });
    });
  });
}

/**
 * Run the GitHub Action entrypoint in a subprocess with the given
 * action inputs as environment variables.
 */
export async function runAction(
  inputs: Record<string, string>,
  env: Record<string, string> = {},
): Promise<RunResult> {
  const actionEnv: Record<string, string> = { ...env };

  // Convert input names to INPUT_ env vars (GitHub Actions convention)
  for (const [key, value] of Object.entries(inputs)) {
    const envKey = `INPUT_${key.toUpperCase().replace(/-/g, "_")}`;
    actionEnv[envKey] = value;
  }

  // The action entrypoint is the built dist/index.js
  const entrypoint = resolve(
    import.meta.dir,
    "../../../dist/index.js",
  );

  return new Promise<RunResult>((resolveResult, reject) => {
    const child = spawn("node", [entrypoint], {
      env: { ...process.env, ...actionEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000);
    }, DEFAULT_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn action: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");

      let json: unknown;
      try {
        if (stdout.trim()) json = JSON.parse(stdout.trim());
      } catch {
        // not JSON
      }

      resolveResult({
        exitCode: code ?? 1,
        stdout,
        stderr,
        json,
        timedOut,
      });
    });
  });
}
