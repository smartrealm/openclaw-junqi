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

export type StorageSetupErrorKind = 'openclaw-unavailable' | 'generic';

const OPENCLAW_UNAVAILABLE_ERROR = 'OpenClaw is not available to verify the selected official Gateway service; storage changes were not started';

export function classifyStorageSetupError(message: string): StorageSetupErrorKind {
  return message.trim() === OPENCLAW_UNAVAILABLE_ERROR
    ? 'openclaw-unavailable'
    : 'generic';
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
