import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Extension } from "@codemirror/state";
import { loadCodeMirrorLanguage } from "@/utils/codeMirrorLanguages";
import type { WorkspaceFilePreview } from "@/utils/filePreviewCapabilities";
import { readFilePreview, readFileText } from "@/services/workspaceFs";
import { subscribeLocalWorkspacePath } from "@/workspace-files/services/localWatchCoordinator";
import type { EditorDocumentSnapshot } from "@/workspace-files/services/editorDocumentManager";
import { acquireLocalEditorDocument } from "@/workspace-files/services/localEditorDocuments";
import { parentPathOf } from "./treeUtils";
import {
  fileIsGone,
  resolveFileViewerPreview,
  usesEditableDocument,
} from "./fileViewerCapabilities";

interface UseWorkspaceFileDocumentOptions {
  filePath: string;
  fileName: string;
  projectPath: string;
  ownerId: string;
  previewMode: boolean;
  onFileMissing?: (path: string) => void;
  onDirtyChange?: (path: string, dirty: boolean) => void;
}

export function useWorkspaceFileDocument({
  filePath,
  fileName,
  projectPath,
  ownerId,
  previewMode,
  onFileMissing,
  onDirtyChange,
}: UseWorkspaceFileDocumentOptions) {
  const [content, setContent] = useState<string | null>(null);
  const [readOnlyPreview, setReadOnlyPreview] = useState<Exclude<WorkspaceFilePreview, { kind: "text" }> | null>(null);
  const [snapshot, setSnapshot] = useState<EditorDocumentSnapshot | null>(null);
  const [languageExtension, setLanguageExtension] = useState<Extension>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diskReadError, setDiskReadError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diskUnavailableRef = useRef(false);
  const onFileMissingRef = useRef(onFileMissing);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const resolvedPreview = useMemo(() => resolveFileViewerPreview(fileName), [fileName]);
  const isMarkdown = resolvedPreview.mode === "markdown";
  const usesTextDocument = useMemo(() => usesEditableDocument(fileName), [fileName]);
  const document = useMemo(
    () => usesTextDocument
      ? acquireLocalEditorDocument(projectPath, filePath, ownerId)
      : null,
    [filePath, ownerId, projectPath, usesTextDocument],
  );

  useEffect(() => {
    onFileMissingRef.current = onFileMissing;
  }, [onFileMissing]);

  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribeDocument: (() => void) | null = null;
    setLoading(true);
    setContent(null);
    setReadOnlyPreview(null);
    setSnapshot(null);
    setError(null);
    setDiskReadError(null);
    diskUnavailableRef.current = false;

    const reportMissingIfGone = async () => {
      if (await fileIsGone(filePath, fileName, projectPath) && !cancelled) {
        onFileMissingRef.current?.(filePath);
      }
    };

    const load = !usesTextDocument
      ? readFilePreview(filePath, projectPath).then((preview) => {
          if (cancelled) return;
          if (preview.kind === "text") setContent(preview.text);
          else setReadOnlyPreview(preview);
          setLoading(false);
        })
      : document
        ? (async () => {
            const update = (next: EditorDocumentSnapshot) => {
              if (cancelled) return;
              setSnapshot(next);
              setContent(next.draftContent);
              setError(next.error);
              setLoading(next.status === "idle" || next.status === "loading");
              const dirty = ["dirty", "saving", "conflicted", "error"].includes(next.status);
              onDirtyChangeRef.current?.(filePath, dirty);
            };
            unsubscribeDocument = document.subscribe(update);
            const initial = document.snapshot();
            update(initial);
            if (initial.status === "idle") await document.load();
            if (document.snapshot().status === "error") await reportMissingIfGone();
          })()
        : Promise.reject(new Error("Document controller unavailable"));

    load.catch(async (reason) => {
      if (cancelled) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setLoading(false);
      await reportMissingIfGone();
    });

    return () => {
      cancelled = true;
      unsubscribeDocument?.();
    };
  }, [document, fileName, filePath, projectPath, usesTextDocument]);

  useEffect(() => {
    const directory = parentPathOf(filePath);
    if (!projectPath || !filePath || !directory) return;
    let alive = true;

    const reload = async () => {
      if (!usesTextDocument) {
        try {
          const preview = await readFilePreview(filePath, projectPath);
          if (!alive) return;
          if (preview.kind === "text") setContent(preview.text);
          else setReadOnlyPreview(preview);
          setError(null);
        } catch (reason) {
          if (!alive) return;
          if (await fileIsGone(filePath, fileName, projectPath)) {
            if (alive) onFileMissingRef.current?.(filePath);
          } else if (alive) {
            setError(reason instanceof Error ? reason.message : String(reason));
          }
        }
        return;
      }

      try {
        const next = await readFileText(filePath, projectPath);
        if (!alive) return;
        diskUnavailableRef.current = false;
        setDiskReadError(null);
        document?.applyExternalChange(next, null);
      } catch (reason) {
        if (!alive) return;
        diskUnavailableRef.current = true;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        setDiskReadError(reason instanceof Error ? reason.message : String(reason));
      }
    };

    let release: (() => void) | null = null;
    void subscribeLocalWorkspacePath(projectPath, directory, () => {
      if (alive) void reload();
    }).then((nextRelease) => {
      if (alive) release = nextRelease;
      else nextRelease();
    }).catch(() => undefined);

    return () => {
      alive = false;
      release?.();
    };
  }, [document, fileName, filePath, projectPath, usesTextDocument]);

  useEffect(() => {
    let alive = true;
    setLanguageExtension([]);
    if (!usesTextDocument || (isMarkdown && previewMode)) return;
    void loadCodeMirrorLanguage(fileName).then((extension) => {
      if (alive) setLanguageExtension(extension);
    }).catch(() => {
      if (alive) setLanguageExtension([]);
    });
    return () => {
      alive = false;
    };
  }, [fileName, isMarkdown, previewMode, usesTextDocument]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  const saveNow = useCallback(async () => {
    if (!document || diskUnavailableRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    await document.save();
  }, [document]);

  const edit = useCallback((value: string) => {
    if (!document) return;
    document.edit(value);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (diskUnavailableRef.current) return;
    saveTimerRef.current = setTimeout(() => {
      if (diskUnavailableRef.current) return;
      void document.save().then(async () => {
        if (document.snapshot().status !== "error") return;
        if (await fileIsGone(filePath, fileName, projectPath)) {
          onFileMissingRef.current?.(filePath);
        }
      });
    }, 1500);
  }, [document, fileName, filePath, projectPath]);

  const reloadFromDisk = useCallback(async () => {
    if (!document) return;
    try {
      const next = await readFileText(filePath, projectPath);
      document.replaceWithDiskContent(next, null);
      diskUnavailableRef.current = false;
      setDiskReadError(null);
    } catch (reason) {
      diskUnavailableRef.current = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setDiskReadError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [document, filePath, projectPath]);

  const keepLocalEdits = useCallback(() => {
    if (!document) return;
    document.keepLocalEdits();
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (!diskUnavailableRef.current) void document.save();
    }, 1500);
  }, [document]);

  return {
    content,
    readOnlyPreview,
    snapshot,
    languageExtension,
    loading,
    error,
    diskReadError,
    isMarkdown,
    edit,
    saveNow,
    reloadFromDisk,
    keepLocalEdits,
  };
}
