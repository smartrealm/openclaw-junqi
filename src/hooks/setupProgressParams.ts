
/**
 * Setup progress → i18n param extraction.
 *
 * The backend emits setup progress as `{ message, key }` pairs. When the
 * key matches an i18n string that contains placeholders (e.g. `{{path}}`),
 * we need to extract the actual values from the raw `message` so
 * `i18next.t(key, { ...params })` can substitute them.
 *
 * Design: a single declarative table of `ParamRule`s. Each rule says
 * "for these key suffixes, this is how to pull params out of the
 * message". The function walks the table and returns the first match.
 * Adding a new i18n key that needs substitution = adding one row.
 * The same table is the test fixture in setupProgressParams.test.ts,
 * so the table cannot drift away from the test cases.
 */

export type ParamExtractor = (
  message: string,
) => Partial<Record<string, string>> | null;

export interface ParamRule {
  /** Key suffix(es) this rule applies to. */
  readonly suffix: string | readonly string[];
  /**
   * Extract i18n params from the raw backend message. Return `null` to
   * fall through to the next rule (e.g. when the key matched but the
   * message has no version/path to extract).
   */
  readonly extract: ParamExtractor;
}

type ProgressTranslator = (
  key: string,
  options: Record<string, unknown>,
) => unknown;

/**
 * Build a single-capture extractor. Returns a function that, when
 * applied to a message, emits `{ [name]: capture[1] }` on match, or
 * `null` on miss.
 */
function capture(pattern: RegExp, name: string): ParamExtractor {
  return (message) => {
    const value = message.match(pattern)?.[1];
    if (!value) return null;
    return { [name]: value };
  };
}

function capture2(versionPattern: RegExp, pathPattern: RegExp): ParamExtractor {
  // The two patterns are mutually exclusive by construction:
  // - `versionPattern` only matches the "Using existing OpenClaw {v} at {p}"
  //   form, where `at` is preceded by a non-trivial token (the version).
  // - `pathPattern` only matches the "Using existing OpenClaw at {p}" form,
  //   where `OpenClaw` is followed by literal ` at` (no version token).
  // We must try both independently — checking `pathPattern` first and
  // short-circuiting on miss would swallow the version+path message,
  // because `pathPattern` legitimately won't match it.
  return (message) => {
    const version = message.match(versionPattern);
    const path = message.match(pathPattern);
    if (version && path) {
      return { version: version[1]!, path: path[1]! };
    }
    if (version) {
      return { version: version[1]!, path: version[2]! };
    }
    if (path) {
      return { path: path[1]! };
    }
    return null;
  };
}

/**
 * Full table of setup progress param rules. Order matters: first match
 * wins. Keep this in sync with `setup.*` keys in
 * `src/locales/{zh,en,ar}.json` that have placeholders.
 */
export const SETUP_PROGRESS_PARAM_RULES: readonly ParamRule[] = [
  // Generic version rule — covers a family of `.skip` / `.upgrade` /
  // `.done` keys whose message embeds a `vX.Y.Z` version number.
  {
    suffix: [".skip", ".upgrade", ".done"],
    extract: capture(
      /(?:Node\.js\s+|Detected\s+)(v?\d+\.\d+\.\d+)/,
      "version",
    ),
  },
  {
    suffix: ".prepareDownload",
    extract: capture(/Node\.js\s+(v?\d+\.\d+\.\d+)/, "version"),
  },
  {
    suffix: ".extract",
    extract: capture(/Extracting to\s+(.+?)(?:\.\.\.|…)?$/, "path"),
  },
  {
    suffix: [".waitingWizard", ".macPolling"],
    extract: capture(/elapsed\s+([0-9:]+)/, "elapsed"),
  },
  {
    suffix: ".useLocalNode",
    extract: capture(/Using (?:local|detected) Node\.js:\s+(.+)$/, "path"),
  },
  {
    suffix: ".useLocalNpm",
    extract: capture(/Using local npm:\s+(.+)$/, "path"),
  },
  {
    suffix: ".useNodeNpm",
    extract: capture(/Using npm bundled with selected Node\.js:\s+(.+)$/, "path"),
  },
  {
    suffix: [".userNpmPrefix", ".userNpmPrefixMissingPath"],
    extract: capture(/Detected npm prefix\s+(.+?)\s+\(matches/, "path"),
  },
  {
    suffix: ".customNpmPrefix",
    extract: capture(/Using custom npm prefix\s+(.+)$/, "path"),
  },
  {
    // `setup.openclaw.useExisting` ships three message variants from
    // the backend: "Using existing OpenClaw {version} at {path}",
    // "Using existing OpenClaw at {path}", and a no-path variant
    // (where the detector found no version/path at all). We extract
    // whatever is present and return null when nothing is — the
    // install-location card needs a path to render.
    suffix: ".useExisting",
    extract: capture2(
      /^Using existing OpenClaw\s+(.+?)\s+at\s+(.+)$/,
      /^Using existing OpenClaw at\s+(.+)$/,
    ),
  },
  {
    suffix: ".prepareDir",
    extract: capture(/Preparing install directory\s+(.+?)(?:\.\.\.|…)?$/, "path"),
  },
  {
    suffix: ".runtimeSummary",
    extract: capture(/Runtime check done:\s+(.+)$/, "summary"),
  },
  {
    suffix: ".binary",
    extract: capture(/^OpenClaw binary:\s+(.+)$/, "path"),
  },
  {
    suffix: ".readPort",
    extract: capture(/^Reading gateway port from\s+(.+?)(?:\.\.\.|…)?$/, "path"),
  },
  {
    suffix: ".targetNode",
    extract: capture(/^Target OpenClaw requires Node\.js\s+(.+?);/, "requirement"),
  },
  {
    suffix: ".runningUpdater",
    extract: capture(/^Running official updater via\s+(.+)$/, "registry"),
  },
  {
    suffix: ".retryingRegistry",
    extract: (message) => {
      const match = message.match(/^Network failure via\s+(.+?);\s+retrying via\s+(.+)$/);
      return match ? { primary: match[1]!, fallback: match[2]! } : null;
    },
  },
  {
    suffix: [".portResolved", ".alreadyUp"],
    extract: capture(/(?:Target port =|[Pp]ort)\s+(\d+)/, "port"),
  },
  {
    suffix: ".probe",
    extract: capture(/127\.0\.0\.1:(\d+)/, "port"),
  },
];

function endsWithAny(
  key: string,
  suffix: string | readonly string[],
): boolean {
  if (typeof suffix === "string") return key.endsWith(suffix);
  return suffix.some((s) => key.endsWith(s));
}

/**
 * Resolve i18n params for a setup progress event. Walks
 * `SETUP_PROGRESS_PARAM_RULES` in declaration order; the first rule
 * whose suffix matches the key AND whose extractor returns a value
 * wins. Returns `{}` when nothing matches.
 */
export function setupProgressI18nParams(
  key: string,
  message: string,
): Partial<Record<string, string>> {
  for (const rule of SETUP_PROGRESS_PARAM_RULES) {
    if (endsWithAny(key, rule.suffix)) {
      const params = rule.extract(message);
      if (params) return params;
    }
  }
  return {};
}

/** Resolve a keyed setup event while preserving raw diagnostic lines verbatim. */
export function translateSetupProgressMessage(
  key: string | null | undefined,
  message: string,
  translate: ProgressTranslator,
  explicitParams: Partial<Record<string, string>> = {},
): string {
  if (!key) return message;
  const translated = String(translate(key, {
    defaultValue: message,
    ...setupProgressI18nParams(key, message),
    ...explicitParams,
  }));
  return translated !== key && !translated.includes("{{") ? translated : message;
}
