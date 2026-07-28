export type WorkspaceFileKind =
  | 'code'
  | 'text'
  | 'markdown'
  | 'html'
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'binary'
  | 'unsupported';

export interface FileKindDescriptor {
  kind: WorkspaceFileKind;
  languageId?: string;
  mimeType?: string;
  editable: boolean;
  previewable: boolean;
  requiresNativeUrl: boolean;
  maxInlineBytes?: number;
}

const EXTENSION_KIND: Readonly<Record<string, WorkspaceFileKind>> = {
  html: 'html', htm: 'html',
  md: 'markdown', markdown: 'markdown', mdown: 'markdown',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  bmp: 'image', ico: 'image', avif: 'image', tif: 'image', tiff: 'image',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio',
  mp4: 'video', webm: 'video', mov: 'video', avi: 'video', mkv: 'video', m4v: 'video',
  pdf: 'pdf',
  txt: 'text', text: 'text', log: 'text', csv: 'text',
  json: 'code', jsonc: 'code', xml: 'code', yml: 'code', yaml: 'code', toml: 'code',
  js: 'code', mjs: 'code', cjs: 'code', ts: 'code', tsx: 'code', jsx: 'code',
  py: 'code', rs: 'code', go: 'code', java: 'code', c: 'code', cpp: 'code', h: 'code', hpp: 'code',
  css: 'code', scss: 'code', sh: 'code', bash: 'code', zsh: 'code', sql: 'code',
};

const MIME_TYPES: Readonly<Partial<Record<WorkspaceFileKind, string>>> = {
  html: 'text/html', markdown: 'text/markdown', pdf: 'application/pdf',
};

export function fileExtension(pathOrName: string): string {
  const normalized = pathOrName.split(/[?#]/, 1)[0]?.replace(/\\/g, '/') ?? '';
  const name = normalized.slice(normalized.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}

export function workspaceFileKind(pathOrName: string): WorkspaceFileKind {
  const extension = fileExtension(pathOrName);
  return extension ? EXTENSION_KIND[extension] ?? 'unsupported' : 'unsupported';
}

export function describeWorkspaceFile(pathOrName: string): FileKindDescriptor {
  const kind = workspaceFileKind(pathOrName);
  const editable = kind === 'code' || kind === 'text' || kind === 'markdown' || kind === 'html';
  const previewable = editable || kind === 'image' || kind === 'audio' || kind === 'video' || kind === 'pdf';
  return {
    kind,
    editable,
    previewable,
    requiresNativeUrl: kind === 'image' || kind === 'audio' || kind === 'video' || kind === 'pdf' || kind === 'html',
    ...(MIME_TYPES[kind] ? { mimeType: MIME_TYPES[kind] } : {}),
    ...(editable ? { maxInlineBytes: 2 * 1024 * 1024 } : {}),
  };
}

export function isImageFile(pathOrName: string): boolean {
  return workspaceFileKind(pathOrName) === 'image';
}
