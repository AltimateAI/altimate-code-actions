/** Supported interactive commands. */
export type CommandName = "review" | "impact" | "cost" | "help" | "unknown";

/** Result of parsing a comment body for an interactive command. */
export interface ParsedCommand {
  /** The recognized command. */
  command: CommandName;
  /** Remaining positional arguments after the command keyword. */
  args: string[];
  /** Specific file path if provided as first arg (convenience accessor). */
  file?: string;
  /** The original comment body, untouched. */
  raw: string;
}

const KNOWN_COMMANDS = new Set<CommandName>(["review", "impact", "cost", "help"]);

/**
 * Parse an interactive command from a PR comment body.
 *
 * Recognizes comments that start with one of the configured mention triggers
 * (e.g. `/altimate`, `/oc`, `@altimate`) followed by an optional command and
 * arguments.
 *
 * Returns `null` if the comment does not start with any of the triggers.
 */
export function parseCommand(commentBody: string, mentions: string[]): ParsedCommand | null {
  const trimmed = commentBody.trim();
  const lower = trimmed.toLowerCase();

  // Find the first matching trigger
  let matchedLength = 0;
  for (const mention of mentions) {
    const mentionLower = mention.toLowerCase().trim();
    if (lower.startsWith(mentionLower)) {
      matchedLength = mentionLower.length;
      break;
    }
  }

  if (matchedLength === 0) return null;

  // Extract everything after the trigger, split on whitespace
  const rest = trimmed.slice(matchedLength).trim();
  const tokens = rest.length > 0 ? rest.split(/\s+/) : [];

  if (tokens.length === 0) {
    // Bare mention with no command — treat as "review" (default action)
    return {
      command: "review",
      args: [],
      raw: commentBody,
    };
  }

  const commandToken = tokens[0].toLowerCase();
  const args = tokens.slice(1);

  if (KNOWN_COMMANDS.has(commandToken as CommandName)) {
    const command = commandToken as CommandName;
    const file = command === "review" && args.length > 0 ? args[0] : undefined;

    return {
      command,
      args,
      file,
      raw: commentBody,
    };
  }

  // Unknown command
  return {
    command: "unknown",
    args: tokens,
    raw: commentBody,
  };
}
