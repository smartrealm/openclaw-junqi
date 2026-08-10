import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import path from "node:path";
import { DingTalkRuntimeError } from "./errors.js";
import type { DwsCommandResult, DwsRunnerConfig } from "./types.js";

const RECOVERY_EVENT_PATTERN = /(?:^|\s)RECOVERY_EVENT_ID=([^\s]+)/m;

const DWS_ENVIRONMENT_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "DWS_CONFIG_DIR",
  "DWS_LANG",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
] as const;

export function buildDwsEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    DWS_ENVIRONMENT_KEYS.flatMap((key) => {
      const value = source[key];
      return typeof value === "string" && value.length > 0 ? [[key, value]] : [];
    }),
  );
}

function integerWithin(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

export function normalizeRunnerConfig(input: Record<string, unknown> | undefined): DwsRunnerConfig {
  const config = input ?? {};
  const configuredPath = typeof config.dwsPath === "string" ? config.dwsPath.trim() : "";
  return {
    ...(configuredPath ? { dwsPath: configuredPath } : {}),
    timeoutMs: integerWithin(config.timeoutMs, 30_000, 1_000, 120_000),
    maxOutputBytes: integerWithin(config.maxOutputBytes, 2_097_152, 65_536, 8_388_608),
  };
}

async function resolveCandidate(candidate: string): Promise<string | null> {
  try {
    await access(candidate, fsConstants.X_OK);
    return await realpath(candidate);
  } catch {
    return null;
  }
}

export async function resolveDwsExecutable(
  configuredPath: string | undefined,
  pathValue = process.env.PATH ?? "",
  platform = process.platform,
): Promise<string> {
  if (configuredPath) {
    if (!path.isAbsolute(configuredPath)) {
      throw new DingTalkRuntimeError(
        "DWS_PATH_NOT_ABSOLUTE",
        "Configured dwsPath must be an absolute path",
      );
    }
    const resolved = await resolveCandidate(configuredPath);
    if (!resolved) {
      throw new DingTalkRuntimeError(
        "DWS_RUNTIME_NOT_EXECUTABLE",
        "Configured DWS executable is missing or not executable",
      );
    }
    return resolved;
  }

  const executableName = platform === "win32" ? "dws.exe" : "dws";
  const candidates = await Promise.all(
    pathValue
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => resolveCandidate(path.join(entry, executableName))),
  );
  const unique = [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))];
  if (unique.length === 0) {
    throw new DingTalkRuntimeError(
      "DWS_RUNTIME_NOT_FOUND",
      "DWS executable was not found in PATH",
    );
  }
  if (unique.length > 1) {
    throw new DingTalkRuntimeError(
      "DWS_PATH_AMBIGUOUS",
      "PATH resolves to multiple DWS executables; configure dwsPath explicitly",
      { matchCount: unique.length },
    );
  }
  const executable = unique[0];
  if (!executable) {
    throw new DingTalkRuntimeError("DWS_RUNTIME_NOT_FOUND", "DWS executable was not found");
  }
  return executable;
}

export function validateProfileReference(profile: unknown): string {
  if (typeof profile !== "string") {
    throw new DingTalkRuntimeError("DWS_PROFILE_REQUIRED", "DWS profile must be provided");
  }
  const normalized = profile.trim();
  if (!/^[^:\s]+:[^:\s]+$/.test(normalized)) {
    throw new DingTalkRuntimeError(
      "DWS_PROFILE_INVALID",
      "DWS profile must use the exact <corpId>:<userId> form",
    );
  }
  return normalized;
}

export function buildDwsCommandArguments(
  command: readonly string[],
  options: { profile?: string; confirmed?: boolean } = {},
): string[] {
  return [
    ...(options.profile ? ["--profile", options.profile] : []),
    ...command,
    "--format",
    "json",
    ...(options.confirmed ? ["--yes"] : []),
  ];
}

function parseJsonOutput(stdout: Buffer, recoveryEventId: string | undefined): DwsCommandResult {
  const text = stdout.toString("utf8").trim();
  if (!text) {
    throw new DingTalkRuntimeError("DWS_EMPTY_OUTPUT", "DWS returned no JSON output");
  }
  try {
    return {
      data: JSON.parse(text) as unknown,
      ...(recoveryEventId ? { recoveryEventId } : {}),
    };
  } catch {
    throw new DingTalkRuntimeError("DWS_INVALID_JSON", "DWS returned invalid JSON output");
  }
}

export class DwsRunner {
  readonly config: DwsRunnerConfig;
  private executable: string | null = null;
  private executableLookup: Promise<string> | null = null;

  constructor(config: DwsRunnerConfig) {
    this.config = config;
  }

  async resolveExecutable(): Promise<string> {
    if (this.executable) return this.executable;
    this.executableLookup ??= resolveDwsExecutable(this.config.dwsPath);
    const lookup = this.executableLookup;
    try {
      const executable = await lookup;
      this.executable = executable;
      return executable;
    } finally {
      if (this.executableLookup === lookup) this.executableLookup = null;
    }
  }

  async run(
    command: readonly string[],
    options: { profile?: string; confirmed?: boolean; signal?: AbortSignal } = {},
  ): Promise<DwsCommandResult> {
    const executable = await this.resolveExecutable();
    const args = buildDwsCommandArguments(command, options);
    return await new Promise<DwsCommandResult>((resolve, reject) => {
      const child = spawn(executable, args, {
        env: buildDwsEnvironment(process.env),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let outputBytes = 0;
      let timedOut = false;
      let overflowed = false;
      let settled = false;

      const stopForOverflow = (): void => {
        if (overflowed) return;
        overflowed = true;
        child.kill();
      };
      const collect = (target: Buffer[], chunk: Buffer | string): void => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        outputBytes += bytes.length;
        if (outputBytes > this.config.maxOutputBytes) {
          stopForOverflow();
          return;
        }
        target.push(bytes);
      };
      child.stdout.on("data", (chunk: Buffer) => collect(stdoutChunks, chunk));
      child.stderr.on("data", (chunk: Buffer) => collect(stderrChunks, chunk));

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, this.config.timeoutMs);
      timer.unref();

      const abort = (): void => {
        child.kill();
      };
      options.signal?.addEventListener("abort", abort, { once: true });

      const cleanup = (): void => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
      };

      child.once("error", () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (this.executable === executable) this.executable = null;
        reject(new DingTalkRuntimeError("DWS_SPAWN_FAILED", "Failed to start DWS"));
      });

      child.once("close", (code, signal) => {
        if (settled) return;
        settled = true;
        cleanup();
        const stdout = Buffer.concat(stdoutChunks);
        const stderr = Buffer.concat(stderrChunks);
        const recoveryEventId = stderr.toString("utf8").match(RECOVERY_EVENT_PATTERN)?.[1];
        if (overflowed) {
          reject(new DingTalkRuntimeError("DWS_OUTPUT_LIMIT", "DWS output exceeded the configured limit"));
          return;
        }
        if (options.signal?.aborted) {
          reject(new DingTalkRuntimeError("DWS_CANCELLED", "DWS execution was cancelled"));
          return;
        }
        if (timedOut) {
          reject(new DingTalkRuntimeError("DWS_TIMEOUT", "DWS execution timed out"));
          return;
        }
        if (code !== 0) {
          reject(new DingTalkRuntimeError(
            "DWS_COMMAND_FAILED",
            "DWS command failed",
            {
              exitCode: code,
              ...(signal ? { signal } : {}),
              ...(recoveryEventId ? { recoveryEventId } : {}),
            },
          ));
          return;
        }
        try {
          resolve(parseJsonOutput(stdout, recoveryEventId));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}
