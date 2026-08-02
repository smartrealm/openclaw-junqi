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

export const DEFAULT_GATEWAY_HOST = validateGatewayHost(runtimeDefaults.gateway.host);
export const DEFAULT_GATEWAY_PORT = validateGatewayPort(runtimeDefaults.gateway.port);

function validatedPort(port: number): number {
  return validateGatewayPort(port);
}

export function defaultGatewayWsUrl(port = DEFAULT_GATEWAY_PORT): string {
  return `ws://${DEFAULT_GATEWAY_HOST}:${validatedPort(port)}`;
}

export function defaultGatewayHttpUrl(port = DEFAULT_GATEWAY_PORT): string {
  return `http://${DEFAULT_GATEWAY_HOST}:${validatedPort(port)}`;
}
