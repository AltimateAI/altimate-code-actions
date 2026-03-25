import type { QueryProfile } from "./types.js";

/**
 * Extract structural metadata from a SQL file using regex-based heuristics.
 * This gives users a "Query Profile" showing complexity, JOINs, CTEs, etc.
 */
export function extractQueryProfile(file: string, sql: string): QueryProfile {
  const joinTypes = extractJoinTypes(sql);

  return {
    file,
    complexity: computeComplexity(sql),
    tablesReferenced: countTables(sql),
    joinCount: joinTypes.length,
    joinTypes: [...new Set(joinTypes)],
    hasAggregation: /\bGROUP\s+BY\b/i.test(sql) || hasAggregateFunctions(sql),
    hasSubquery: /\(\s*SELECT\b/i.test(sql),
    hasWindowFunction: /\bOVER\s*\(/i.test(sql),
    hasCTE: /\bWITH\s+\w+\s+AS\s*\(/i.test(sql),
  };
}

/** Count the number of JOIN clauses by type. */
function extractJoinTypes(sql: string): string[] {
  const types: string[] = [];
  const joinPattern =
    /\b(INNER|LEFT\s+OUTER|RIGHT\s+OUTER|FULL\s+OUTER|LEFT|RIGHT|FULL|CROSS)?\s*JOIN\b/gi;
  let match;
  while ((match = joinPattern.exec(sql)) !== null) {
    const prefix = (match[1] ?? "INNER").trim().toUpperCase();
    // Normalize multi-word types
    if (prefix.startsWith("LEFT")) types.push("LEFT");
    else if (prefix.startsWith("RIGHT")) types.push("RIGHT");
    else if (prefix.startsWith("FULL")) types.push("FULL");
    else if (prefix === "CROSS") types.push("CROSS");
    else types.push("INNER");
  }
  return types;
}

/** Count tables referenced via FROM and JOIN clauses. */
function countTables(sql: string): number {
  const tables = new Set<string>();

  // FROM <table>
  const fromPattern = /\bFROM\s+([a-zA-Z_][\w.]*)/gi;
  let match;
  while ((match = fromPattern.exec(sql)) !== null) {
    tables.add(match[1].toLowerCase());
  }

  // JOIN <table>
  const joinPattern = /\bJOIN\s+([a-zA-Z_][\w.]*)/gi;
  while ((match = joinPattern.exec(sql)) !== null) {
    tables.add(match[1].toLowerCase());
  }

  return tables.size;
}

/** Check for aggregate functions like COUNT, SUM, AVG, MIN, MAX. */
function hasAggregateFunctions(sql: string): boolean {
  return /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(sql);
}

/** Estimate query complexity based on structural features. */
function computeComplexity(sql: string): "Low" | "Medium" | "High" {
  let score = 0;

  const joinCount = (sql.match(/\bJOIN\b/gi) ?? []).length;
  score += joinCount;

  if (/\bGROUP\s+BY\b/i.test(sql)) score += 1;
  if (/\bHAVING\b/i.test(sql)) score += 1;
  if (/\bOVER\s*\(/i.test(sql)) score += 2;
  if (/\(\s*SELECT\b/i.test(sql)) score += 2;
  if (/\bWITH\s+\w+\s+AS\s*\(/i.test(sql)) score += 1;
  if (/\bUNION\b/i.test(sql)) score += 2;
  if (/\bCASE\b/i.test(sql)) score += 1;

  // Count number of CTEs
  const cteCount = (sql.match(/\bAS\s*\(\s*SELECT\b/gi) ?? []).length;
  if (cteCount > 2) score += 1;

  if (score <= 2) return "Low";
  if (score <= 5) return "Medium";
  return "High";
}
