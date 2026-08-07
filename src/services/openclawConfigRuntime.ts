import {
  parseOpenclawConfigText,
  readOpenclawConfig,
  validateOpenclawConfig,
  type OpenclawConfigReadResult,
  type OpenclawConfigValidationResult,
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
