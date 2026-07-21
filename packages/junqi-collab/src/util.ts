import { createHash, randomUUID } from "node:crypto";
import { RequestValidationError } from "./errors.js";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex");
}

export function parseJsonObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestValidationError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RequestValidationError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

export function readOptionalString(value: unknown, field: string): string | undefined {
  if (value == null) return undefined;
  return readString(value, field);
}

export function readInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new RequestValidationError(`${field} must be an integer`);
  }
  return value;
}

export function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      try {
        return JSON.parse(fenced.trim());
      } catch {
        throw new RequestValidationError("Agent response did not contain a JSON object");
      }
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        throw new RequestValidationError("Agent response did not contain a JSON object");
      }
    }
    throw new RequestValidationError("Agent response did not contain a JSON object");
  }
}

export function latestAssistantText(messages: unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") continue;
    const row = message as Record<string, unknown>;
    if (row.role !== "assistant") continue;
    if (typeof row.content === "string" && row.content.trim()) return row.content;
    if (Array.isArray(row.content)) {
      const text = row.content
        .map((part) => {
          if (!part || typeof part !== "object") return "";
          const value = part as Record<string, unknown>;
          return value.type === "text" && typeof value.text === "string" ? value.text : "";
        })
        .filter(Boolean)
        .join("\n");
      if (text.trim()) return text;
    }
  }
  return null;
}

export function nowMs(): number {
  return Date.now();
}
