export interface StorageCompletion {
  createdFresh: boolean;
  runtimeReconfigurationRequired?: boolean;
  openclawRelocationRequired?: boolean;
}

export interface ExistingStorageStatus {
  configured: boolean;
  openclawRelocationRequired: boolean;
}

export function initialStorageCompletion(
  status: ExistingStorageStatus | null,
  hasDraft: boolean,
  forceConfigure: boolean,
): StorageCompletion | null {
  if (!status?.configured || hasDraft || forceConfigure) return null;
  return {
    createdFresh: false,
    openclawRelocationRequired: status.openclawRelocationRequired,
  };
}
