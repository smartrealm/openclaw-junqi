const RFC3339_TIMESTAMP = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})`;
const TIMESTAMP_PREFIX = new RegExp(`^((?:${RFC3339_TIMESTAMP}\\s+){1,2})(.*)$`, 'u');
const SAFE_OPERATIONAL_LINES = Object.freeze([
  Object.freeze({ code: 'GATEWAY_STARTUP', pattern: /^\[gateway\] (?:loading configuration|resolving authentication|starting\.\.\.|starting HTTP server\.\.\.|starting channels and sidecars\.\.\.)$/u }),
  Object.freeze({ code: 'GATEWAY_READY', pattern: /^\[gateway\] ready$/u }),
  Object.freeze({ code: 'GATEWAY_MODEL_SELECTED', pattern: /^\[gateway\] agent model: [A-Za-z0-9._/-]+ \(thinking=(?:on|off), fast=(?:on|off)\)$/u }),
  Object.freeze({ code: 'GATEWAY_LISTENING', pattern: /^\[gateway\] http server listening \(\d+ plugin(?:s)?: [A-Za-z0-9._/-]+; [0-9.]+s\)$/u }),
  Object.freeze({ code: 'GATEWAY_LOG_PATH', pattern: /^\[gateway\] log file: \/tmp\/[A-Za-z0-9._/-]+$/u }),
  Object.freeze({ code: 'GATEWAY_SHUTDOWN', pattern: /^\[gateway\] (?:signal SIGTERM received|received SIGTERM; shutting down)$/u }),
  Object.freeze({ code: 'GATEWAY_WARM', pattern: /^\[gateway\] agent runtime plugins pre-warmed in \d+ms$/u }),
  Object.freeze({ code: 'HEALTH_MONITOR_STARTED', pattern: /^\[health-monitor\] started \(interval: \d+s, startup-grace: \d+s, channel-connect-grace: \d+s\)$/u }),
  Object.freeze({ code: 'HEARTBEAT_DISABLED', pattern: /^\[heartbeat\] disabled$/u }),
  Object.freeze({ code: 'SHUTDOWN', pattern: /^\[shutdown\] (?:started: gateway stopping|completed cleanly in \d+ms)$/u }),
]);

export const GATEWAY_EVIDENCE_LOG_POLICY = 'PAYLOAD_FREE_LOG_PROJECTION_V2';
export const REDACTED_GATEWAY_OUTPUT = '[MODEL_OUTPUT_REDACTED]';

function containsPrivateFragment(value, privateFragments) {
  return privateFragments.some((fragment) => value.includes(fragment));
}

function classifyLine(line, privateFragments) {
  const timestampMatch = TIMESTAMP_PREFIX.exec(line);
  if (!timestampMatch) return { prefix: '', payload: line, code: null };
  const [, prefix, payload] = timestampMatch;
  const event = SAFE_OPERATIONAL_LINES.find(({ pattern }) => pattern.test(payload));
  const code = event && !containsPrivateFragment(payload, privateFragments) ? event.code : null;
  return { prefix, payload, code };
}

/**
 * Gateway stdout mixes component diagnostics with bare model output. Evidence
 * keeps only timestamped, component-tagged diagnostics; every ambiguous line
 * is replaced so a future OpenClaw log shape fails closed.
 */
export function sanitizeGatewayEvidenceLog(value, options = {}) {
  const privateFragments = (options.privateFragments ?? []).filter(
    (fragment) => typeof fragment === 'string' && fragment.length > 0,
  );
  const source = String(value ?? '');
  const trailingNewline = source.endsWith('\n');
  const lines = source.split(/\r?\n/u);
  if (trailingNewline) lines.pop();

  let preservedLineCount = 0;
  let redactedLineCount = 0;
  const sanitizedLines = lines.map((line) => {
    if (line.length === 0) return line;
    const classification = classifyLine(line, privateFragments);
    if (classification.code) {
      preservedLineCount += 1;
      return `${classification.prefix}[OPERATIONAL_EVENT:${classification.code}]`;
    }
    redactedLineCount += 1;
    return `${classification.prefix}${REDACTED_GATEWAY_OUTPUT}`;
  });

  const text = `${sanitizedLines.join('\n')}${trailingNewline ? '\n' : ''}`;
  return Object.freeze({
    policy: GATEWAY_EVIDENCE_LOG_POLICY,
    text,
    totalLineCount: preservedLineCount + redactedLineCount,
    preservedLineCount,
    redactedLineCount,
    privateFragmentCount: privateFragments.filter((fragment) => text.includes(fragment)).length,
  });
}
