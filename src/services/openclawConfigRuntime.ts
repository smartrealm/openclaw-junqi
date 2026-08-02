import {
  parseOpenclawConfigText,
  readOpenclawConfig,
  validateOpenclawConfig,
  writeOpenclawConfig,
  type OpenclawConfigReadResult,
  type OpenclawConfigValidationResult,
  type OpenclawConfigWriteResult,
} from '@/api/tauri-commands';
import type { GatewayRuntimeConfig } from '@/types/openclawConfig';

/**
 * The only renderer service for the selected runtime's OpenClaw config file.
 * It deliberately excludes renderer-local connection preferences, which have
 * a different ownership and credential lifecycle.
 */
export function readActiveOpenclawConfig(): Promise<OpenclawConfigReadResult> {
  return readOpenclawConfig();
}

export function validateActiveOpenclawConfig(): Promise<OpenclawConfigValidationResult> {
  return validateOpenclawConfig();
}

export function parseActiveOpenclawConfig(raw: string): Promise<GatewayRuntimeConfig> {
  return parseOpenclawConfigText(raw);
}

export function writeActiveOpenclawConfig(
  data: GatewayRuntimeConfig,
  expectedRevision?: string,
): Promise<OpenclawConfigWriteResult> {
  return writeOpenclawConfig(data, expectedRevision);
}

/** Reset is a selected-runtime write, not a renderer-local recovery action. */
export function resetActiveOpenclawConfig(): Promise<OpenclawConfigWriteResult> {
  return writeOpenclawConfig({});
}
