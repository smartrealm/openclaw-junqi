import { describeWorkspaceFile, fileExtension, type WorkspaceFileKind } from '../domain/fileKinds';
import type { WorkspaceFileCapabilities, WorkspaceFilePolicy } from '../domain/types';

export type WorkspacePreviewMode =
  | 'editor'
  | 'markdown'
  | 'json'
  | 'static-html'
  | 'isolated-html'
  | 'scoped-media'
  | 'scoped-pdf'
  | 'native-only'
  | 'unsupported';

export interface WorkspacePreviewRequest {
  path: string;
  policy: WorkspaceFilePolicy;
  capabilities: Pick<WorkspaceFileCapabilities, 'read' | 'write' | 'nativePreview'>;
  byteSize?: number;
  interactiveHtml?: boolean;
}

export interface WorkspacePreviewResolution {
  kind: WorkspaceFileKind;
  mode: WorkspacePreviewMode;
  editable: boolean;
  reason?: 'read-unavailable' | 'preview-unavailable' | 'too-large' | 'unsupported';
}

export function resolveWorkspacePreview(request: WorkspacePreviewRequest): WorkspacePreviewResolution {
  const descriptor = describeWorkspaceFile(request.path);
  if (!request.capabilities.read) {
    return { kind: descriptor.kind, mode: 'unsupported', editable: false, reason: 'read-unavailable' };
  }
  if (request.byteSize !== undefined && descriptor.maxInlineBytes !== undefined && request.byteSize > descriptor.maxInlineBytes) {
    return {
      kind: descriptor.kind,
      mode: request.capabilities.nativePreview ? 'native-only' : 'unsupported',
      editable: false,
      reason: 'too-large',
    };
  }
  const editable = descriptor.editable
    && request.policy === 'workspace'
    && request.capabilities.write;
  if (descriptor.kind === 'code' && fileExtension(request.path) === 'json') {
    return { kind: descriptor.kind, mode: 'json', editable };
  }
  if (descriptor.kind === 'code' || descriptor.kind === 'text') {
    return { kind: descriptor.kind, mode: 'editor', editable };
  }
  if (descriptor.kind === 'markdown') {
    return { kind: descriptor.kind, mode: 'markdown', editable };
  }
  if (descriptor.kind === 'html') {
    if (request.interactiveHtml && request.capabilities.nativePreview) {
      return { kind: descriptor.kind, mode: 'isolated-html', editable };
    }
    return { kind: descriptor.kind, mode: 'static-html', editable };
  }
  if (descriptor.kind === 'image' || descriptor.kind === 'audio' || descriptor.kind === 'video') {
    return request.capabilities.nativePreview
      ? { kind: descriptor.kind, mode: 'scoped-media', editable: false }
      : { kind: descriptor.kind, mode: 'unsupported', editable: false, reason: 'preview-unavailable' };
  }
  if (descriptor.kind === 'pdf') {
    return request.capabilities.nativePreview
      ? { kind: descriptor.kind, mode: 'scoped-pdf', editable: false }
      : { kind: descriptor.kind, mode: 'unsupported', editable: false, reason: 'preview-unavailable' };
  }
  return { kind: descriptor.kind, mode: 'unsupported', editable: false, reason: 'unsupported' };
}
