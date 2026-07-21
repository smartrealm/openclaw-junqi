import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARGO_WORKSPACE = path.join(REPOSITORY_ROOT, 'src-tauri');

export const DEFAULT_CARGO_FETCH_ATTEMPTS = 3;
export const DEFAULT_CARGO_FETCH_DELAY_MS = 2_000;

export class CargoDependencyFetchError extends Error {
  constructor(message, { cause = undefined } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'CargoDependencyFetchError';
    this.code = 'CARGO_FETCH_FAILED';
  }
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new CargoDependencyFetchError(`${label} must be a positive integer`);
  }
  return parsed;
}

function nonBlankOrDefault(value, fallback) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function assertTarget(target) {
  if (typeof target !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(target)) {
    throw new CargoDependencyFetchError('Cargo target must be a safe Rust target triple');
  }
  return target;
}

export function parseCargoFetchOptions(argv, environment = process.env) {
  let target;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag !== '--target' || value === undefined || target !== undefined) {
      throw new CargoDependencyFetchError('Usage: fetch-cargo-dependencies.mjs --target <rust-target>');
    }
    target = assertTarget(value);
  }
  if (!target) throw new CargoDependencyFetchError('Usage: fetch-cargo-dependencies.mjs --target <rust-target>');

  return {
    target,
    attempts: positiveInteger(
      nonBlankOrDefault(environment.JUNQI_CARGO_FETCH_ATTEMPTS, String(DEFAULT_CARGO_FETCH_ATTEMPTS)),
      'JUNQI_CARGO_FETCH_ATTEMPTS',
    ),
    delayMs: positiveInteger(
      nonBlankOrDefault(environment.JUNQI_CARGO_FETCH_DELAY_MS, String(DEFAULT_CARGO_FETCH_DELAY_MS)),
      'JUNQI_CARGO_FETCH_DELAY_MS',
    ),
  };
}

export function cargoNetworkEnvironment(environment = process.env) {
  return {
    ...environment,
    CARGO_NET_RETRY: nonBlankOrDefault(environment.CARGO_NET_RETRY, '2'),
    CARGO_HTTP_TIMEOUT: nonBlankOrDefault(environment.CARGO_HTTP_TIMEOUT, '120'),
    CARGO_HTTP_MULTIPLEXING: nonBlankOrDefault(environment.CARGO_HTTP_MULTIPLEXING, 'false'),
  };
}

function runCargoFetch({ target, cwd, environment }) {
  return new Promise((resolve, reject) => {
    const child = spawn('cargo', ['fetch', '--locked', '--target', target], {
      cwd,
      env: environment,
      stdio: 'inherit',
    });
    let settled = false;
    const settle = (callback) => (...args) => {
      if (settled) return;
      settled = true;
      callback(...args);
    };
    child.once('error', settle(reject));
    child.once('exit', settle((code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new CargoDependencyFetchError(
        `cargo fetch failed for ${target}${signal ? ` (signal ${signal})` : ` (exit ${code ?? 'unknown'})`}`,
      ));
    }));
  });
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function fetchLockedCargoDependencies({
  target,
  attempts = DEFAULT_CARGO_FETCH_ATTEMPTS,
  delayMs = DEFAULT_CARGO_FETCH_DELAY_MS,
  cwd = CARGO_WORKSPACE,
  environment = process.env,
  run = runCargoFetch,
  wait = sleep,
} = {}) {
  const safeTarget = assertTarget(target);
  const safeAttempts = positiveInteger(attempts, 'attempts');
  const safeDelayMs = positiveInteger(delayMs, 'delayMs');
  const networkEnvironment = cargoNetworkEnvironment(environment);
  let lastError;

  for (let attempt = 1; attempt <= safeAttempts; attempt += 1) {
    process.stdout.write(`Fetching locked Cargo dependencies for ${safeTarget} (${attempt}/${safeAttempts})\n`);
    try {
      await run({ target: safeTarget, cwd, environment: networkEnvironment });
      return;
    } catch (error) {
      lastError = error;
      if (attempt === safeAttempts) break;
      const delay = safeDelayMs * attempt;
      process.stderr.write(
        `Cargo dependency fetch failed for ${safeTarget}; retrying in ${delay}ms (${attempt}/${safeAttempts}).\n`,
      );
      await wait(delay);
    }
  }

  throw new CargoDependencyFetchError(
    `Unable to fetch locked Cargo dependencies for ${safeTarget} after ${safeAttempts} attempts`,
    { cause: lastError },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseCargoFetchOptions(process.argv.slice(2));
    await fetchLockedCargoDependencies(options);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
