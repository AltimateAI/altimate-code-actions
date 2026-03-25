import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FIXTURES = resolve(import.meta.dir, "fixtures/pii");

/** PII column name patterns. */
const PII_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\bemail\b/i, category: "email" },
  { pattern: /\bcontact_email\b/i, category: "email" },
  { pattern: /\bssn\b/i, category: "ssn" },
  { pattern: /\bsocial_security/i, category: "ssn" },
  { pattern: /\bphone\b/i, category: "phone" },
  { pattern: /\bmobile_phone\b/i, category: "phone" },
  { pattern: /\bphone_number\b/i, category: "phone" },
  { pattern: /\bdate_of_birth\b/i, category: "dob" },
  { pattern: /\bcredit_card/i, category: "credit_card" },
  { pattern: /\baddress\b/i, category: "address" },
  { pattern: /\bstreet_address\b/i, category: "address" },
  { pattern: /\bhome_address\b/i, category: "address" },
  { pattern: /\bip_address\b/i, category: "ip_address" },
  { pattern: /\btax_id\b/i, category: "tax_id" },
  { pattern: /\bfirst_name\b/i, category: "name" },
  { pattern: /\blast_name\b/i, category: "name" },
];

/** Patterns that look like PII but are not. */
const FALSE_POSITIVE_PATTERNS = [
  /\bemail_pref(erence)?\b/i,
  /\bphone_model\b/i,
  /\baddress_type\b/i,
  /\baddress_id\b/i,
  /\bip_address_count\b/i,
];

interface PIIFinding {
  column: string;
  category: string;
  line?: number;
}

/**
 * Detect PII-sensitive column names in SQL content.
 */
function detectPII(sql: string): PIIFinding[] {
  const findings: PIIFinding[] = [];
  const lines = sql.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comments
    if (line.trim().startsWith("--")) continue;

    // Extract identifiers from the line
    const identifiers = extractIdentifiers(line);

    for (const ident of identifiers) {
      // Skip false positives
      if (FALSE_POSITIVE_PATTERNS.some((fp) => fp.test(ident))) continue;

      for (const { pattern, category } of PII_PATTERNS) {
        if (pattern.test(ident)) {
          // Don't duplicate
          if (!findings.some((f) => f.column === ident && f.category === category)) {
            findings.push({ column: ident, category, line: i + 1 });
          }
          break;
        }
      }
    }
  }

  return findings;
}

/** Extract SQL identifiers from a line. */
function extractIdentifiers(line: string): string[] {
  // Remove string literals
  const cleaned = line.replace(/'[^']*'/g, "").replace(/"[^"]*"/g, "");
  // Match word sequences that look like column names
  const matches = cleaned.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
  // Filter out SQL keywords
  const keywords = new Set([
    "select",
    "from",
    "where",
    "and",
    "or",
    "not",
    "in",
    "as",
    "join",
    "on",
    "left",
    "right",
    "inner",
    "outer",
    "cross",
    "group",
    "by",
    "order",
    "having",
    "limit",
    "offset",
    "insert",
    "update",
    "delete",
    "create",
    "table",
    "alter",
    "drop",
    "index",
    "into",
    "values",
    "set",
    "null",
    "true",
    "false",
    "like",
    "between",
    "case",
    "when",
    "then",
    "else",
    "end",
    "cast",
    "is",
    "varchar",
    "int",
    "integer",
    "bigint",
    "text",
    "date",
    "timestamp",
    "boolean",
    "serial",
    "decimal",
    "numeric",
    "primary",
    "key",
    "references",
    "default",
    "current_timestamp",
    "unique",
    "constraint",
    "foreign",
  ]);
  return matches.filter((m) => !keywords.has(m.toLowerCase()));
}

describe("PII Detection", () => {
  it("flags email columns", () => {
    const sql = readFileSync(resolve(FIXTURES, "pii-columns.sql"), "utf-8");
    const findings = detectPII(sql);

    const emailFindings = findings.filter((f) => f.category === "email");
    expect(emailFindings.length).toBeGreaterThan(0);
    expect(emailFindings.some((f) => f.column === "email")).toBe(true);
  });

  it("flags SSN patterns", () => {
    const sql = readFileSync(resolve(FIXTURES, "pii-columns.sql"), "utf-8");
    const findings = detectPII(sql);

    const ssnFindings = findings.filter((f) => f.category === "ssn");
    expect(ssnFindings.length).toBeGreaterThan(0);
  });

  it("flags phone number columns", () => {
    const sql = readFileSync(resolve(FIXTURES, "pii-columns.sql"), "utf-8");
    const findings = detectPII(sql);

    const phoneFindings = findings.filter((f) => f.category === "phone");
    expect(phoneFindings.length).toBeGreaterThan(0);
    expect(phoneFindings.some((f) => f.column === "phone_number")).toBe(true);
  });

  it("flags credit card columns", () => {
    const sql = readFileSync(resolve(FIXTURES, "pii-columns.sql"), "utf-8");
    const findings = detectPII(sql);

    const ccFindings = findings.filter((f) => f.category === "credit_card");
    expect(ccFindings.length).toBeGreaterThan(0);
  });

  it("flags address columns", () => {
    const sql = readFileSync(resolve(FIXTURES, "pii-columns.sql"), "utf-8");
    const findings = detectPII(sql);

    const addrFindings = findings.filter((f) => f.category === "address");
    expect(addrFindings.length).toBeGreaterThan(0);
  });

  it("flags name columns", () => {
    const sql = readFileSync(resolve(FIXTURES, "pii-columns.sql"), "utf-8");
    const findings = detectPII(sql);

    const nameFindings = findings.filter((f) => f.category === "name");
    expect(nameFindings.length).toBeGreaterThan(0);
  });

  it("does not flag safe columns", () => {
    const sql = readFileSync(resolve(FIXTURES, "safe-columns.sql"), "utf-8");
    const findings = detectPII(sql);

    expect(findings).toHaveLength(0);
  });

  it("handles edge cases - does not false-positive on email_pref", () => {
    const sql = readFileSync(resolve(FIXTURES, "edge-cases.sql"), "utf-8");
    const findings = detectPII(sql);

    // Should NOT flag email_pref
    expect(findings.some((f) => f.column === "email_pref")).toBe(false);
    expect(findings.some((f) => f.column === "user_email_preference")).toBe(false);
  });

  it("handles edge cases - does not false-positive on phone_model", () => {
    const sql = readFileSync(resolve(FIXTURES, "edge-cases.sql"), "utf-8");
    const findings = detectPII(sql);

    expect(findings.some((f) => f.column === "phone_model")).toBe(false);
  });

  it("handles edge cases - does not false-positive on address_type", () => {
    const sql = readFileSync(resolve(FIXTURES, "edge-cases.sql"), "utf-8");
    const findings = detectPII(sql);

    expect(findings.some((f) => f.column === "address_type")).toBe(false);
  });

  it("handles edge cases - flags real PII in mixed content", () => {
    const sql = readFileSync(resolve(FIXTURES, "edge-cases.sql"), "utf-8");
    const findings = detectPII(sql);

    // Should flag contact_email
    expect(findings.some((f) => f.column === "contact_email")).toBe(true);
    // Should flag mobile_phone
    expect(findings.some((f) => f.column === "mobile_phone")).toBe(true);
    // Should flag street_address
    expect(findings.some((f) => f.column === "street_address")).toBe(true);
    // Should flag tax_id
    expect(findings.some((f) => f.column === "tax_id")).toBe(true);
  });

  it("does not flag order_id as PII", () => {
    const sql = readFileSync(resolve(FIXTURES, "edge-cases.sql"), "utf-8");
    const findings = detectPII(sql);

    expect(findings.some((f) => f.column === "order_id")).toBe(false);
  });

  it("returns line numbers for findings", () => {
    const sql = readFileSync(resolve(FIXTURES, "pii-columns.sql"), "utf-8");
    const findings = detectPII(sql);

    for (const finding of findings) {
      expect(finding.line).toBeDefined();
      expect(finding.line).toBeGreaterThan(0);
    }
  });

  it("handles empty SQL input", () => {
    const findings = detectPII("");
    expect(findings).toHaveLength(0);
  });

  it("handles SQL with only comments", () => {
    const findings = detectPII("-- This is a comment\n-- with email mentioned\n");
    expect(findings).toHaveLength(0);
  });
});
