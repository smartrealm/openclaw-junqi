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

export function nodeRequirementFromRuntimeRecoveryError(message: string): string | null {
  const match = message.match(/OpenClaw requires Node\.js (.+?); no compatible runtime was found/);
  return match?.[1]?.trim() || null;
}

export function portFromRuntimeRecoveryError(message: string): number | null {
  const match = message.match(/Candidate Gateway port (\d+) is occupied by a process JunQi cannot verify or stop/);
  if (!match?.[1]) return null;
  const port = Number(match[1]);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
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
