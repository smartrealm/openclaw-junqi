export interface StorageCompletion {
  createdFresh: boolean;
  runtimeReconfigurationRequired?: boolean;
  openclawRelocationRequired?: boolean;
}

export function initialStorageLocationsVisibility(savedVisibility?: boolean): boolean {
  return savedVisibility ?? true;
}

export interface StorageSubmissionPresentation {
  contentIdentity: 'storage:form';
  locked: boolean;
  loading: boolean;
  action: 'continue' | 'confirm-current' | 'prepare-new';
}

export function storageSubmissionPresentation(
  applying: boolean,
  usingSourceLocation: boolean,
): StorageSubmissionPresentation {
  return {
    contentIdentity: 'storage:form',
    locked: applying,
    loading: applying,
    action: applying
      ? usingSourceLocation ? 'confirm-current' : 'prepare-new'
      : 'continue',
  };
}
