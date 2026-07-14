export const GATEWAY_OPTIONAL_PATHS = [
  '/settings',
  '/terminal',
  '/welcome',
  '/config',
  '/logs',
  '/openclaw-commands',
] as const;

export function routePathFromLocation(location: Pick<Location, 'hash' | 'pathname'>): string {
  const hashPath = location.hash.startsWith('#/') ? location.hash.slice(1) : '';
  const rawPath = hashPath || location.pathname || '/';
  return rawPath.split(/[?#]/, 1)[0] || '/';
}

export function isGatewayOptionalPath(pathname: string): boolean {
  return GATEWAY_OPTIONAL_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
