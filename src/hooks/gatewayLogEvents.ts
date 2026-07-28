import { translateSetupProgressMessage, type ProgressTranslator } from "./setupProgressParams";

export interface GatewayLogMessage {
  message: string;
  key: string | null;
}

/**
 * Read a `gateway-log` payload. Lines this app authors carry the translation
 * key for their message; child process output and older payloads arrive as a
 * bare string and stay verbatim.
 */
export function normalizeGatewayLogPayload(payload: unknown): GatewayLogMessage | null {
  if (typeof payload === "string") {
    const message = payload.trim();
    return message ? { message, key: null } : null;
  }
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.message !== "string" || !value.message.trim()) return null;
  return {
    message: value.message.trim(),
    key: typeof value.key === "string" && value.key ? value.key : null,
  };
}

/** Resolve a `gateway-log` payload to the text the user should read. */
export function translateGatewayLogPayload(
  payload: unknown,
  translate: ProgressTranslator,
): string | null {
  const line = normalizeGatewayLogPayload(payload);
  if (!line) return null;
  return translateSetupProgressMessage(line.key, line.message, translate);
}
