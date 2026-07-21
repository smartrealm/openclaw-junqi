import {
  CollaborationMaintenanceError,
  collaborationMaintenanceCoordinator,
  type CollaborationMaintenanceAcquisition,
  type CollaborationMaintenanceRelease,
} from './collaboration/MaintenanceCoordinator';

export { CollaborationMaintenanceError } from './collaboration/MaintenanceCoordinator';
export type {
  CollaborationMaintenanceAcquisition,
  CollaborationMaintenanceRelease,
} from './collaboration/MaintenanceCoordinator';

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

export function beginOpenclawUpdateMaintenance(): Promise<CollaborationMaintenanceAcquisition> {
  return collaborationMaintenanceCoordinator.acquire('openclaw-update');
}

export function assertOpenclawUpdateMaintenanceCurrent(
  acquisition: CollaborationMaintenanceAcquisition,
): Promise<void> {
  return collaborationMaintenanceCoordinator.assertAcquisitionCurrent(acquisition);
}

export function finishOpenclawUpdateMaintenance(
  acquisition: CollaborationMaintenanceAcquisition,
): Promise<CollaborationMaintenanceRelease> {
  if (!acquisition.guarded || !acquisition.lease) {
    return Promise.resolve({
      released: false,
      alreadyInactive: true,
      lease: null,
      status: acquisition.status,
    });
  }
  return collaborationMaintenanceCoordinator.verifyAndRelease(acquisition.lease);
}

export function recoverOpenclawUpdateMaintenance(): Promise<CollaborationMaintenanceRelease> {
  return collaborationMaintenanceCoordinator.recover();
}

export function failOpenclawUpdateMaintenance(
  acquisition: CollaborationMaintenanceAcquisition,
  error: unknown,
): CollaborationMaintenanceError {
  return collaborationMaintenanceCoordinator.operationFailed(acquisition, error);
}
