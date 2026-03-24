import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename, relative } from "node:path";
import * as core from "@actions/core";
import type { ChangedFile, ImpactResult } from "../analysis/types.js";

/**
 * Extract model names from `{{ ref('model_name') }}` calls in SQL.
 * Handles single and double quotes, optional whitespace.
 */
export function extractRefs(sql: string): string[] {
  const refs: string[] = [];
  const pattern = /\{\{\s*ref\s*\(\s*['"](\w+)['"]\s*\)\s*\}\}/gi;
  let match;
  while ((match = pattern.exec(sql)) !== null) {
    refs.push(match[1]);
  }
  return [...new Set(refs)];
}

/**
 * Extract source references from `{{ source('source_name', 'table_name') }}` calls.
 * Returns "source_name.table_name" strings.
 */
export function extractSources(sql: string): string[] {
  const sources: string[] = [];
  const pattern =
    /\{\{\s*source\s*\(\s*['"](\w+)['"]\s*,\s*['"](\w+)['"]\s*\)\s*\}\}/gi;
  let match;
  while ((match = pattern.exec(sql)) !== null) {
    sources.push(`${match[1]}.${match[2]}`);
  }
  return [...new Set(sources)];
}

/**
 * Recursively find all .sql files under `dir`.
 */
export function findSQLFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findSQLFiles(fullPath));
    } else if (entry.endsWith(".sql")) {
      results.push(fullPath);
    }
  }
  return results;
}

export interface LightweightNode {
  name: string;
  filePath: string;
  refs: string[];
  sources: string[];
}

export interface LightweightDAG {
  /** Map of model name to node metadata. */
  nodes: Map<string, LightweightNode>;
  /** Map of model name to its direct children (models that ref it). */
  childMap: Map<string, string[]>;
}

/**
 * Build a lightweight DAG by scanning all .sql files in the dbt project's
 * model directories and extracting ref() calls.
 *
 * This requires NO manifest, NO CLI, NO LLM.
 */
export function buildLightweightDAG(dbtProjectDir: string): LightweightDAG {
  const nodes = new Map<string, LightweightNode>();
  const childMap = new Map<string, string[]>();

  // Find model directories — check common locations
  const modelDirs = ["models", "dbt_models", "model"];
  let sqlFiles: string[] = [];

  for (const dir of modelDirs) {
    const fullDir = join(dbtProjectDir, dir);
    if (existsSync(fullDir)) {
      sqlFiles.push(...findSQLFiles(fullDir));
    }
  }

  // Fallback: scan entire project if no model dir found
  if (sqlFiles.length === 0) {
    sqlFiles = findSQLFiles(dbtProjectDir).filter(
      (f) => !f.includes("target/") && !f.includes("dbt_packages/"),
    );
  }

  // Build nodes
  for (const filePath of sqlFiles) {
    const modelName = basename(filePath, ".sql");
    const sql = readFileSync(filePath, "utf-8");
    const refs = extractRefs(sql);
    const sources = extractSources(sql);

    nodes.set(modelName, { name: modelName, filePath, refs, sources });
  }

  // Build childMap from ref() edges: if model B refs model A, then A -> B
  for (const [modelName, node] of nodes) {
    for (const parentName of node.refs) {
      if (!childMap.has(parentName)) {
        childMap.set(parentName, []);
      }
      childMap.get(parentName)!.push(modelName);
    }
  }

  core.info(
    `Lightweight DAG: ${nodes.size} models, ${[...childMap.values()].reduce((s, c) => s + c.length, 0)} edges`,
  );

  return { nodes, childMap };
}

/**
 * Analyze impact using the lightweight DAG (no manifest needed).
 *
 * 1. Scans all .sql files in the project to build ref() edges
 * 2. Maps changed files to model names
 * 3. BFS from changed models to find all downstream
 * 4. Builds explicit edges for Mermaid rendering
 * 5. Returns ImpactResult
 */
export function analyzeLightweightImpact(
  changedFiles: ChangedFile[],
  dbtProjectDir: string,
): ImpactResult | null {
  const dag = buildLightweightDAG(dbtProjectDir);

  if (dag.nodes.size === 0) {
    core.info("Lightweight DAG: no models found — skipping impact analysis");
    return null;
  }

  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();

  // Map changed files to model names
  const modifiedModels: string[] = [];
  for (const file of changedFiles) {
    if (!file.filename.endsWith(".sql")) continue;
    const modelName = basename(file.filename, ".sql");
    if (dag.nodes.has(modelName)) {
      modifiedModels.push(modelName);
    } else {
      // Try matching by file path
      const absPath = join(workspace, file.filename);
      for (const [name, node] of dag.nodes) {
        const relFromProject = relative(dbtProjectDir, node.filePath);
        const relFromWorkspace = relative(workspace, node.filePath);
        if (
          file.filename === relFromProject ||
          file.filename === relFromWorkspace ||
          absPath === node.filePath
        ) {
          modifiedModels.push(name);
          break;
        }
      }
    }
  }

  const uniqueModified = [...new Set(modifiedModels)];

  if (uniqueModified.length === 0) {
    core.info(
      "Lightweight DAG: no changed files matched any models — skipping",
    );
    return {
      modifiedModels: [],
      downstreamModels: [],
      affectedExposures: [],
      affectedTests: [],
      impactScore: 0,
    };
  }

  // BFS to find downstream models
  const visited = new Set<string>(uniqueModified);
  const queue = [...uniqueModified];
  const downstreamModels: string[] = [];
  const edges: Array<{ from: string; to: string }> = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = dag.childMap.get(current) ?? [];

    for (const child of children) {
      edges.push({ from: current, to: child });
      if (!visited.has(child)) {
        visited.add(child);
        downstreamModels.push(child);
        queue.push(child);
      }
    }
  }

  // Compute a simple impact score
  const totalModels = dag.nodes.size;
  const affectedRatio =
    (uniqueModified.length + downstreamModels.length) / totalModels;
  const downstreamScore = Math.min(50, Math.round(affectedRatio * 100));
  const modificationScore = Math.min(20, uniqueModified.length * 5);
  const impactScore = Math.min(100, downstreamScore + modificationScore);

  core.info(
    `Lightweight impact: ${uniqueModified.length} modified, ${downstreamModels.length} downstream, score=${impactScore}`,
  );

  return {
    modifiedModels: uniqueModified,
    downstreamModels,
    affectedExposures: [],
    affectedTests: [],
    impactScore,
    edges,
  };
}
