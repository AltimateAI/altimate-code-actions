import { describe, it, expect } from "bun:test";
import { parseCommand } from "../../src/interactive/commands.js";

const DEFAULT_MENTIONS = ["/altimate", "/oc", "@altimate"];

describe("parseCommand", () => {
  describe("review command", () => {
    it("parses '/altimate review' correctly", () => {
      const result = parseCommand("/altimate review", DEFAULT_MENTIONS);
      expect(result).not.toBeNull();
      expect(result!.command).toBe("review");
      expect(result!.args).toEqual([]);
      expect(result!.file).toBeUndefined();
    });

    it("parses '/altimate review models/foo.sql' with file arg", () => {
      const result = parseCommand(
        "/altimate review models/staging/stg_orders.sql",
        DEFAULT_MENTIONS,
      );
      expect(result).not.toBeNull();
      expect(result!.command).toBe("review");
      expect(result!.args).toEqual(["models/staging/stg_orders.sql"]);
      expect(result!.file).toBe("models/staging/stg_orders.sql");
    });

    it("treats bare mention as review", () => {
      const result = parseCommand("/altimate", DEFAULT_MENTIONS);
      expect(result).not.toBeNull();
      expect(result!.command).toBe("review");
      expect(result!.args).toEqual([]);
    });
  });

  describe("alternative mentions", () => {
    it("parses '/oc impact' with short mention", () => {
      const result = parseCommand("/oc impact", DEFAULT_MENTIONS);
      expect(result).not.toBeNull();
      expect(result!.command).toBe("impact");
      expect(result!.args).toEqual([]);
    });

    it("parses '@altimate help' with @ mention", () => {
      const result = parseCommand("@altimate help", DEFAULT_MENTIONS);
      expect(result).not.toBeNull();
      expect(result!.command).toBe("help");
      expect(result!.args).toEqual([]);
    });

    it("parses '/oc review models/foo.sql'", () => {
      const result = parseCommand("/oc review models/foo.sql", DEFAULT_MENTIONS);
      expect(result).not.toBeNull();
      expect(result!.command).toBe("review");
      expect(result!.file).toBe("models/foo.sql");
    });
  });

  describe("all supported commands", () => {
    it("parses impact command", () => {
      const result = parseCommand("/altimate impact", DEFAULT_MENTIONS);
      expect(result).not.toBeNull();
      expect(result!.command).toBe("impact");
    });

    it("parses cost command", () => {
      const result = parseCommand("/altimate cost", DEFAULT_MENTIONS);
      expect(result).not.toBeNull();
      expect(result!.command).toBe("cost");
    });

    it("parses help command", () => {
      const result = parseCommand("/altimate help", DEFAULT_MENTIONS);
      expect(result).not.toBeNull();
      expect(result!.command).toBe("help");
    });
  });

  describe("non-matching comments", () => {
    it("returns null for unrelated comments", () => {
      expect(parseCommand("This is a regular comment", DEFAULT_MENTIONS)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseCommand("", DEFAULT_MENTIONS)).toBeNull();
    });

    it("returns null when mention is in the middle of comment", () => {
      expect(parseCommand("Hey can you run /altimate review?", DEFAULT_MENTIONS)).toBeNull();
    });

    it("returns null with empty mentions list", () => {
      expect(parseCommand("/altimate review", [])).toBeNull();
    });
  });

  describe("case insensitivity", () => {
    it("handles uppercase command", () => {
      const result = parseCommand("/altimate REVIEW", DEFAULT_MENTIONS);
      expect(result).not.toBeNull();
      expect(result!.command).toBe("review");
    });

    it("handles mixed case mention", () => {
      const result = parseCommand("/Altimate Review", DEFAULT_MENTIONS);
      expect(result).not.toBeNull();
      expect(result!.command).toBe("review");
    });

    it("handles uppercase mention", () => {
      const result = parseCommand("/OC impact", DEFAULT_MENTIONS);
      expect(result).not.toBeNull();
      expect(result!.command).toBe("impact");
    });
  });

  describe("whitespace handling", () => {
    it("handles leading whitespace", () => {
      const result = parseCommand("  /altimate review", DEFAULT_MENTIONS);
      expect(result).not.toBeNull();
      expect(result!.command).toBe("review");
    });

    it("handles trailing whitespace", () => {
      const result = parseCommand("/altimate review  ", DEFAULT_MENTIONS);
      expect(result).not.toBeNull();
      expect(result!.command).toBe("review");
      expect(result!.args).toEqual([]);
    });

    it("handles extra whitespace between tokens", () => {
      const result = parseCommand("/altimate   review   models/foo.sql", DEFAULT_MENTIONS);
      expect(result).not.toBeNull();
      expect(result!.command).toBe("review");
      expect(result!.file).toBe("models/foo.sql");
    });
  });

  describe("unknown commands", () => {
    it("returns unknown for unrecognized command", () => {
      const result = parseCommand("/altimate deploy", DEFAULT_MENTIONS);
      expect(result).not.toBeNull();
      expect(result!.command).toBe("unknown");
      expect(result!.args).toEqual(["deploy"]);
    });

    it("returns unknown for gibberish after mention", () => {
      const result = parseCommand("/altimate xyz abc", DEFAULT_MENTIONS);
      expect(result).not.toBeNull();
      expect(result!.command).toBe("unknown");
      expect(result!.args).toEqual(["xyz", "abc"]);
    });
  });

  describe("raw field", () => {
    it("preserves original comment body", () => {
      const original = "  /altimate  REVIEW  models/foo.sql  ";
      const result = parseCommand(original, DEFAULT_MENTIONS);
      expect(result).not.toBeNull();
      expect(result!.raw).toBe(original);
    });
  });

  describe("file arg only on review", () => {
    it("does not set file for impact command with extra args", () => {
      const result = parseCommand("/altimate impact models/foo.sql", DEFAULT_MENTIONS);
      expect(result).not.toBeNull();
      expect(result!.command).toBe("impact");
      expect(result!.file).toBeUndefined();
      expect(result!.args).toEqual(["models/foo.sql"]);
    });
  });
});
