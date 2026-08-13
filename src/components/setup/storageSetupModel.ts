export interface StorageCompletion {
  createdFresh: boolean;
  runtimeReconfigurationRequired?: boolean;
  openclawRelocationRequired?: boolean;
}

export function initialStorageLocationsVisibility(savedVisibility?: boolean): boolean {
  return savedVisibility ?? true;
}
