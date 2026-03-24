import * as core from "@actions/core";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { existsSync } from "node:fs";
import { runCLIOrThrow } from "../util/cli.js";
import type {
  ChangedFile,
  DBTManifest,
  DBTManifestNode,
} from "../analysis/types.js";

/**
 * Detect the dbt project root by searching for dbt_project.yml.
 *
 * Search order:
 * 1. Explicit path from action input
 * 2. Repo root
 * 3. Common subdirectories (dbt/, transform/, models/ parent)
 *
 * Returns the absolute path to the dbt project root, or undefined if not found.
 */
export function detectDBTProject(explicitDir?: string): string | undefined {
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();

  if (explicitDir) {
    const resolved = join(workspace, explicitDir);
    if (existsSync(join(resolved, "dbt_project.yml"))) {
      core.info(`dbt project found at explicit path: ${resolved}`);
      return resolved;
    }
    core.warning(
      `dbt_project.yml not found at specified path: ${resolved}`,
    );
    return undefined;
  }

  // Check repo root
  if (existsSync(join(workspace, "dbt_project.yml"))) {
    core.info(`dbt project found at repo root: ${workspace}`);
    return workspace;
  }

  // Check common subdirectories
  const candidates = ["dbt", "transform", "analytics", "data"];
  for (const dir of candidates) {
    const candidate = join(workspace, dir);
    if (existsSync(join(candidate, "dbt_project.yml"))) {
      core.info(`dbt project found at: ${candidate}`);
      return candidate;
    }
  }

  core.info("No dbt project detected in this repository");
  return undefined;
}

/**
 * Load the dbt manifest.json. Reads from the given path, or falls back to
 * the default target/manifest.json relative to the dbt project root.
 *
 * If no manifest exists, attempts to generate one via `altimate-code run`
 * with dbt compile. Returns undefined if manifest cannot be obtained.
 */
export async function getManifest(
  dbtProjectDir: string,
  explicitManifestPath?: string,
): Promise<DBTManifest | undefined> {
  const manifestPath =
    explicitManifestPath ?? join(dbtProjectDir, "target", "manifest.json");

  // Try reading existing manifest first
  if (existsSync(manifestPath)) {
    core.info(`Reading existing manifest from: ${manifestPath}`);
    return parseManifestFile(manifestPath);
  }

  // Attempt to compile dbt to generate manifest
  core.info("No manifest found — attempting dbt compile via CLI...");
  try {
    await runCLIOrThrow(
      ["run", "--format", "json", "--prompt", "run dbt compile"],
      { cwd: dbtProjectDir, timeout: 120_000 },
    );

    const defaultPath = join(dbtProjectDir, "target", "manifest.json");
    if (existsSync(defaultPath)) {
      return parseManifestFile(defaultPath);
    }
  } catch (err) {
    core.warning(
      `Could not compile dbt project: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  core.warning(
    "No dbt manifest available — impact analysis will be limited",
  );
  return undefined;
}

/**
 * Parse a manifest.json file into our simplified structure.
 */
async function parseManifestFile(path: string): Promise<DBTManifest> {
  const raw = await readFile(path, "utf-8");
  const data = JSON.parse(raw) as Record<string, unknown>;

  const nodes = (data.nodes ?? {}) as Record<string, DBTManifestNode>;
  const sources = (data.sources ?? {}) as Record<string, DBTManifestNode>;
  const exposures = (data.exposures ?? {}) as Record<string, DBTManifestNode>;
  const childMap = (data.child_map ?? {}) as Record<string, string[]>;
  const parentMap = (data.parent_map ?? {}) as Record<string, string[]>;

  const nodeCount = Object.keys(nodes).length;
  const sourceCount = Object.keys(sources).length;
  core.info(
    `Manifest loaded: ${nodeCount} node(s), ${sourceCount} source(s)`,
  );

  return { nodes, sources, exposures, childMap, parentMap };
}

/**
 * Map changed files to dbt model unique IDs using the manifest.
 * Matches by the `original_file_path` or `path` fields in manifest nodes.
 */
export function getModifiedModels(
  changedFiles: ChangedFile[],
  manifest: DBTManifest,
  dbtProjectDir: string,
): string[] {
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const modelIds: string[] = [];

  // Build a lookup from relative file path to unique_id
  const pathToId = new Map<string, string>();
  for (const [uniqueId, node] of Object.entries(manifest.nodes)) {
    const filePath =
      node.original_file_path ?? node.path;
    if (filePath) {
      pathToId.set(filePath, uniqueId);
    }
  }

  for (const file of changedFiles) {
    // Compute the path relative to the dbt project dir, since manifest paths
    // are relative to the dbt project root.
    const absPath = join(workspace, file.filename);
    const relPath = relative(dbtProjectDir, absPath);

    if (pathToId.has(relPath)) {
      modelIds.push(pathToId.get(relPath)!);
    } else if (pathToId.has(file.filename)) {
      // Fallback: try the raw filename
      modelIds.push(pathToId.get(file.filename)!);
    }
  }

  core.info(
    `Mapped ${changedFiles.length} changed file(s) to ${modelIds.length} dbt model(s)`,
  );
  return modelIds;
}

/**
 * Walk the child_map to find all downstream nodes of the given model IDs.
 * Returns a deduplicated list of downstream unique IDs (excluding the input models).
 */
export function getDownstreamModels(
  modelIds: string[],
  manifest: DBTManifest,
): string[] {
  const visited = new Set<string>(modelIds);
  const queue = [...modelIds];
  const downstream: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = manifest.childMap[current] ?? [];

    for (const child of children) {
      if (!visited.has(child)) {
        visited.add(child);
        downstream.push(child);
        queue.push(child);
      }
    }
  }

  return downstream;
}

/**
 * Find exposures that depend on any of the given model IDs (directly or
 * transitively via downstream).
 */
export function getAffectedExposures(
  modelIds: string[],
  downstream: string[],
  manifest: DBTManifest,
): string[] {
  const allAffected = new Set([...modelIds, ...downstream]);
  const exposures: string[] = [];

  for (const [uniqueId, exposure] of Object.entries(manifest.exposures)) {
    const deps = exposure.depends_on?.nodes ?? [];
    if (deps.some((dep) => allAffected.has(dep))) {
      exposures.push(uniqueId);
    }
  }

  return exposures;
}

/**
 * Find tests that reference any of the given model IDs.
 */
export function getAffectedTests(
  modelIds: string[],
  manifest: DBTManifest,
): string[] {
  const modelSet = new Set(modelIds);
  const tests: string[] = [];

  for (const [uniqueId, node] of Object.entries(manifest.nodes)) {
    if (node.resource_type !== "test") continue;
    const deps = node.depends_on?.nodes ?? [];
    if (deps.some((dep) => modelSet.has(dep))) {
      tests.push(uniqueId);
    }
  }

  return tests;
}
