import runtimeDefaults from './runtime-defaults.json';

function validateGatewayHost(value: unknown): string {
  if (typeof value !== 'string') throw new Error('runtime-defaults gateway.host must be a string');
  const octets = value.split('.').map(Number);
  if (octets.length !== 4 || octets[0] !== 127 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    throw new Error('runtime-defaults gateway.host must be an IPv4 loopback address');
  }
  return value;
}

function validateGatewayPort(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65_535) {
    throw new Error('runtime-defaults gateway.port must be an integer from 1 to 65535');
  }
  return value as number;
}

function validateHttpUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`runtime-defaults ${field} must be a non-empty URL`);
  }
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`runtime-defaults ${field} must use http or https`);
  }
  return url.toString().replace(/\/$/, '');
}

export const DEFAULT_GATEWAY_HOST = validateGatewayHost(runtimeDefaults.gateway.host);
export const DEFAULT_GATEWAY_PORT = validateGatewayPort(runtimeDefaults.gateway.port);
export const DEFAULT_MEMORY_API_URL = validateHttpUrl(runtimeDefaults.memoryApi.url, 'memoryApi.url');

function validatedPort(port: number): number {
  return validateGatewayPort(port);
}

export function defaultGatewayWsUrl(port = DEFAULT_GATEWAY_PORT): string {
  return `ws://${DEFAULT_GATEWAY_HOST}:${validatedPort(port)}`;
}

export function defaultGatewayHttpUrl(port = DEFAULT_GATEWAY_PORT): string {
  return `http://${DEFAULT_GATEWAY_HOST}:${validatedPort(port)}`;
}
