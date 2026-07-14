export const OPENCLAW_UPDATE_MAINTENANCE_STARTED = 'aegis:openclaw-update-maintenance-started';
export const OPENCLAW_UPDATE_MAINTENANCE_FINISHED = 'aegis:openclaw-update-maintenance-finished';

let activeMaintenanceOperations = 0;

export function dispatchOpenclawUpdateMaintenanceStarted(): void {
  activeMaintenanceOperations += 1;
  if (activeMaintenanceOperations === 1) {
    window.dispatchEvent(new CustomEvent(OPENCLAW_UPDATE_MAINTENANCE_STARTED));
  }
}

export function dispatchOpenclawUpdateMaintenanceFinished(): void {
  if (activeMaintenanceOperations === 0) return;
  activeMaintenanceOperations -= 1;
  if (activeMaintenanceOperations === 0) {
    window.dispatchEvent(new CustomEvent(OPENCLAW_UPDATE_MAINTENANCE_FINISHED));
  }
}
