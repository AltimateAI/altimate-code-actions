import * as core from "@actions/core";
import {
  getModifiedModels,
  getDownstreamModels,
  getAffectedExposures,
  getAffectedTests,
} from "../context/dbt.js";
import type {
  ChangedFile,
  DBTManifest,
  ImpactResult,
} from "./types.js";

/**
 * Analyze the impact of changed dbt models on the DAG.
 *
 * Walks the manifest's child_map to find downstream models, affected
 * exposures, and tests. Computes an impact score based on the breadth
 * of the blast radius.
 */
export async function analyzeImpact(
  changedFiles: ChangedFile[],
  manifest: DBTManifest,
  dbtProjectDir: string,
): Promise<ImpactResult> {
  const modifiedModelIds = getModifiedModels(
    changedFiles,
    manifest,
    dbtProjectDir,
  );

  if (modifiedModelIds.length === 0) {
    core.info("No dbt models matched the changed files — skipping impact analysis");
    return {
      modifiedModels: [],
      downstreamModels: [],
      affectedExposures: [],
      affectedTests: [],
      impactScore: 0,
    };
  }

  const modifiedNames = modifiedModelIds.map((id) => {
    const node = manifest.nodes[id];
    return node?.name ?? id.split(".").pop() ?? id;
  });

  core.info(`Modified models: ${modifiedNames.join(", ")}`);

  const downstreamIds = getDownstreamModels(modifiedModelIds, manifest);
  const downstreamNames = downstreamIds.map((id) => {
    const node = manifest.nodes[id];
    return node?.name ?? id.split(".").pop() ?? id;
  });

  const exposureIds = getAffectedExposures(
    modifiedModelIds,
    downstreamIds,
    manifest,
  );
  const exposureNames = exposureIds.map((id) => {
    const node = manifest.exposures[id];
    return node?.name ?? id.split(".").pop() ?? id;
  });

  const testIds = getAffectedTests(modifiedModelIds, manifest);
  const testNames = testIds.map((id) => {
    const node = manifest.nodes[id];
    return node?.name ?? id.split(".").pop() ?? id;
  });

  const impactScore = computeImpactScore(
    modifiedModelIds.length,
    downstreamIds.length,
    exposureIds.length,
    Object.keys(manifest.nodes).length,
  );

  core.info(
    `Impact: ${downstreamIds.length} downstream, ${exposureIds.length} exposure(s), ` +
      `${testIds.length} test(s), score=${impactScore}`,
  );

  return {
    modifiedModels: modifiedNames,
    downstreamModels: downstreamNames,
    affectedExposures: exposureNames,
    affectedTests: testNames,
    impactScore,
  };
}

/**
 * Compute an impact score from 0-100 based on the blast radius.
 *
 * Heuristic:
 * - Base score from ratio of affected nodes to total nodes (0-50)
 * - Bonus for affected exposures (dashboards are high-visibility) (0-30)
 * - Bonus for number of directly modified models (0-20)
 */
function computeImpactScore(
  modifiedCount: number,
  downstreamCount: number,
  exposureCount: number,
  totalNodes: number,
): number {
  if (totalNodes === 0) return 0;

  const affectedRatio =
    (modifiedCount + downstreamCount) / totalNodes;

  // Downstream ratio contributes 0-50
  const downstreamScore = Math.min(50, Math.round(affectedRatio * 100));

  // Exposures contribute 0-30 (each exposure is ~10 points, capped)
  const exposureScore = Math.min(30, exposureCount * 10);

  // Direct modifications contribute 0-20 (each model is ~5 points, capped)
  const modificationScore = Math.min(20, modifiedCount * 5);

  return Math.min(100, downstreamScore + exposureScore + modificationScore);
}
