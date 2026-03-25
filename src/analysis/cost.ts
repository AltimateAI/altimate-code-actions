import * as core from "@actions/core";
import { runCLI } from "../util/cli.js";
import { getFileContent, getHeadSHA } from "../util/octokit.js";
import type { ChangedFile, CostEstimate, ActionConfig } from "./types.js";

/**
 * Estimate the cost impact of changed SQL files using the altimate-code CLI's
 * finops capabilities.
 *
 * For each file, sends the SQL content to the CLI with a cost estimation prompt.
 * Requires warehouse_type and warehouse_connection to be configured.
 */
export async function estimateCost(
  files: ChangedFile[],
  config: ActionConfig,
): Promise<CostEstimate[]> {
  if (files.length === 0) {
    core.info("No SQL files for cost estimation");
    return [];
  }

  if (!config.warehouseType) {
    core.warning("Cost estimation enabled but no warehouse_type configured — skipping");
    return [];
  }

  core.info(`Estimating cost for ${files.length} file(s) on ${config.warehouseType}`);

  const estimates: CostEstimate[] = [];

  for (const file of files) {
    try {
      const estimate = await estimateOneFile(file, config);
      if (estimate) {
        estimates.push(estimate);
      }
    } catch (err) {
      core.warning(
        `Cost estimation failed for ${file.filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const totalDelta = estimates.reduce((sum, e) => sum + e.costDelta, 0);
  core.info(
    `Cost estimation complete: ${estimates.length} estimate(s), ` +
      `total delta: $${totalDelta.toFixed(2)}/month`,
  );

  return estimates;
}

async function estimateOneFile(
  file: ChangedFile,
  config: ActionConfig,
): Promise<CostEstimate | undefined> {
  let sqlContent: string;
  try {
    sqlContent = await getFileContent(file.filename, getHeadSHA());
  } catch {
    sqlContent = file.patch ?? "";
  }

  if (!sqlContent.trim()) {
    return undefined;
  }

  const prompt = buildCostPrompt(file.filename, sqlContent, config);

  const env: Record<string, string> = {
    MODEL: config.model,
  };

  if (config.warehouseType) {
    env.WAREHOUSE_TYPE = config.warehouseType;
  }

  if (config.warehouseConnection) {
    env.WAREHOUSE_CONNECTION = JSON.stringify(config.warehouseConnection);
  }

  const result = await runCLI(["run", "--format", "json", "--prompt", prompt], {
    parseJson: true,
    env,
    timeout: 60_000,
  });

  return parseCostOutput(file.filename, result.json ?? result.stdout);
}

function buildCostPrompt(filename: string, content: string, config: ActionConfig): string {
  const lines: string[] = [];

  lines.push(
    `Estimate the monthly query cost impact of the following SQL on ${config.warehouseType ?? "unknown"}.`,
  );
  lines.push(
    "Return a JSON object with: costDelta (number, USD/month), " +
      "explanation (string describing the cost factors).",
  );
  lines.push("If you cannot estimate, return costDelta: 0 with an explanation of why.");
  lines.push(`File: ${filename}`);
  lines.push("```sql");
  lines.push(content.replace(/```/g, "\\`\\`\\`"));
  lines.push("```");

  return lines.join("\n");
}

function parseCostOutput(filename: string, output: unknown): CostEstimate | undefined {
  if (!output) return undefined;

  if (typeof output === "object" && output !== null) {
    const obj = output as Record<string, unknown>;
    const costDelta =
      typeof obj.costDelta === "number"
        ? obj.costDelta
        : typeof obj.cost_delta === "number"
          ? obj.cost_delta
          : 0;

    return {
      file: filename,
      costDelta,
      currency: "USD",
      explanation: typeof obj.explanation === "string" ? obj.explanation : undefined,
      costBefore: typeof obj.costBefore === "number" ? obj.costBefore : undefined,
      costAfter: typeof obj.costAfter === "number" ? obj.costAfter : undefined,
    };
  }

  if (typeof output === "string") {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        return parseCostOutput(filename, parsed);
      } catch {
        // Ignore parse failures
      }
    }
  }

  return undefined;
}

/**
 * Aggregate cost estimates into a total monthly delta.
 */
export function getTotalCostDelta(estimates: CostEstimate[]): number {
  return estimates.reduce((sum, e) => sum + e.costDelta, 0);
}
