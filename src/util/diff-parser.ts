import type { ParsedDiff, DiffHunk, DiffLine } from "../analysis/types.js";

/**
 * Parse a unified diff string (as returned by GitHub's API) into a structured
 * representation. Each file gets its own ParsedDiff with hunks and lines.
 */
export function parseDiff(diffText: string): ParsedDiff[] {
  const results: ParsedDiff[] = [];
  const lines = diffText.split("\n");

  let current: ParsedDiff | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    // File header: diff --git a/path b/path
    const fileMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (fileMatch) {
      if (current) {
        if (currentHunk) current.hunks.push(currentHunk);
        results.push(current);
      }
      current = {
        file: fileMatch[2],
        hunks: [],
        isNew: false,
        isDeleted: false,
        isRenamed: fileMatch[1] !== fileMatch[2],
      };
      currentHunk = null;
      continue;
    }

    if (!current) continue;

    // Detect new file
    if (line.startsWith("new file mode")) {
      current.isNew = true;
      continue;
    }

    // Detect deleted file
    if (line.startsWith("deleted file mode")) {
      current.isDeleted = true;
      continue;
    }

    // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@
    const hunkMatch = line.match(
      /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/,
    );
    if (hunkMatch) {
      if (currentHunk) current.hunks.push(currentHunk);
      const oldStart = parseInt(hunkMatch[1], 10);
      const oldCount = parseInt(hunkMatch[2] ?? "1", 10);
      const newStart = parseInt(hunkMatch[3], 10);
      const newCount = parseInt(hunkMatch[4] ?? "1", 10);
      oldLine = oldStart;
      newLine = newStart;
      currentHunk = { oldStart, oldCount, newStart, newCount, lines: [] };
      continue;
    }

    if (!currentHunk) continue;

    // Diff lines
    if (line.startsWith("+")) {
      const dl: DiffLine = {
        type: "add",
        content: line.slice(1),
        newLineNumber: newLine,
      };
      currentHunk.lines.push(dl);
      newLine++;
    } else if (line.startsWith("-")) {
      const dl: DiffLine = {
        type: "remove",
        content: line.slice(1),
        oldLineNumber: oldLine,
      };
      currentHunk.lines.push(dl);
      oldLine++;
    } else if (line.startsWith(" ")) {
      const dl: DiffLine = {
        type: "context",
        content: line.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      };
      currentHunk.lines.push(dl);
      oldLine++;
      newLine++;
    }
    // Skip lines starting with \ (no newline at end of file) and other noise
  }

  // Flush last file/hunk
  if (current) {
    if (currentHunk) current.hunks.push(currentHunk);
    results.push(current);
  }

  return results;
}

/**
 * Extract only the added SQL content from a parsed diff — useful for analyzing
 * new or modified SQL without noise from removed lines.
 */
export function extractAddedSQL(diff: ParsedDiff): string {
  const addedLines: string[] = [];
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add" || line.type === "context") {
        addedLines.push(line.content);
      }
    }
  }
  return addedLines.join("\n");
}

/**
 * Get the full new-side content from a diff (context + added lines in order).
 * This reconstructs the file as it looks after the change.
 */
export function reconstructNewContent(diff: ParsedDiff): string {
  const lines: string[] = [];
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add" || line.type === "context") {
        lines.push(line.content);
      }
    }
  }
  return lines.join("\n");
}

/** Check if a filename is a SQL file. */
export function isSQLFile(filename: string): boolean {
  return /\.(sql|sqlx)$/i.test(filename);
}

/** Check if a filename is a dbt model or config file. */
export function isDBTFile(filename: string): boolean {
  return (
    isSQLFile(filename) ||
    /\.(yml|yaml)$/i.test(filename) ||
    /\.py$/i.test(filename) // Python models in dbt
  );
}
