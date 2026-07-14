export const OPENCLAW_UPDATE_MAINTENANCE_STARTED = 'aegis:openclaw-update-maintenance-started';
export const OPENCLAW_UPDATE_MAINTENANCE_FINISHED = 'aegis:openclaw-update-maintenance-finished';

export function dispatchOpenclawUpdateMaintenanceStarted(): void {
  window.dispatchEvent(new CustomEvent(OPENCLAW_UPDATE_MAINTENANCE_STARTED));
}

export function dispatchOpenclawUpdateMaintenanceFinished(): void {
  window.dispatchEvent(new CustomEvent(OPENCLAW_UPDATE_MAINTENANCE_FINISHED));
}
