export interface GatewayLogLine {
  level: string;
  source: string;
  message: string;
}

export function formatGatewayLogs(
  entries: GatewayLogLine[],
  limit = 80,
): { stdout: string; stderr: string } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  for (const entry of entries.slice(-limit)) {
    const line = `[${entry.source}] ${entry.message}`;
    if (entry.level === 'error' || entry.source.endsWith('_stderr')) stderr.push(line);
    else stdout.push(line);
  }
  return { stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}
