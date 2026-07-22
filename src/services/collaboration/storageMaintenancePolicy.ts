export type StorageMaintenanceMode = 'guarded' | 'native-bootstrap';

export interface StorageMaintenanceContext {
  /** A prior JunQi storage bootstrap exists and may own a live runtime. */
  configured: boolean;
  /** The user is deliberately reconfiguring an existing layout. */
  forceConfigure: boolean;
  /** An authenticated Gateway connection can authoritatively inspect collaboration state. */
  gatewayConnected: boolean;
}

/**
 * Storage bootstrap happens before a Gateway exists, so it cannot truthfully
 * query collaboration maintenance. The native storage transaction owns its
 * runtime lock and local Gateway handoff for that one bootstrap case. Every
 * established or reconfiguration path keeps the collaboration gate mandatory.
 */
export function resolveStorageMaintenanceMode(
  context: StorageMaintenanceContext,
): StorageMaintenanceMode {
  if (!context.configured && !context.forceConfigure && !context.gatewayConnected) {
    return 'native-bootstrap';
  }
  return 'guarded';
}
