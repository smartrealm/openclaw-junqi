export interface TextDocumentState {
  content: string | null;
  diskBaseline: string | null;
  conflictDiskContent: string | null;
}

export type DiskTextChangeDecision = "not-ready" | "unchanged" | "reload" | "conflict";

export const EMPTY_TEXT_DOCUMENT: TextDocumentState = {
  content: null,
  diskBaseline: null,
  conflictDiskContent: null,
};

export function loadTextDocument(content: string): TextDocumentState {
  return { content, diskBaseline: content, conflictDiskContent: null };
}

export function editTextDocument(
  document: TextDocumentState,
  content: string,
): TextDocumentState {
  return { ...document, content };
}

export function reconcileDiskTextDocument(
  document: TextDocumentState,
  diskContent: string,
  discardLocalEdits = false,
): { document: TextDocumentState; decision: DiskTextChangeDecision } {
  const { content, diskBaseline } = document;
  if (content === null || diskBaseline === null) {
    return { document, decision: "not-ready" };
  }

  if (discardLocalEdits || diskContent === content || content === diskBaseline) {
    return { document: loadTextDocument(diskContent), decision: "reload" };
  }

  if (diskContent === diskBaseline) {
    return {
      document: { ...document, conflictDiskContent: null },
      decision: "unchanged",
    };
  }

  return {
    document: { ...document, conflictDiskContent: diskContent },
    decision: "conflict",
  };
}

export function keepLocalTextEdits(document: TextDocumentState): TextDocumentState {
  if (document.conflictDiskContent === null) return document;
  return {
    ...document,
    diskBaseline: document.conflictDiskContent,
    conflictDiskContent: null,
  };
}

export function completeTextSave(
  document: TextDocumentState,
  savedContent: string,
): TextDocumentState {
  return { ...document, diskBaseline: savedContent, conflictDiskContent: null };
}

export function textDocumentIsDirty(document: TextDocumentState): boolean {
  return document.content !== null && document.content !== document.diskBaseline;
}
