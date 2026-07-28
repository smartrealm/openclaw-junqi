import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  decodeWorkspaceFilePreview,
  type WorkspaceFilePreview,
} from "@/utils/filePreviewCapabilities";
import {
  EMPTY_TEXT_DOCUMENT,
  completeTextSave,
  editTextDocument,
  keepLocalTextEdits,
  loadTextDocument,
  reconcileDiskTextDocument,
  textDocumentIsDirty,
  type TextDocumentState,
} from "./filePreviewSync";
import { useFileDiskWatcher } from "./useFileDiskWatcher";

const AUTOSAVE_DELAY_MS = 1500;
const SAVED_STATUS_DURATION_MS = 2000;

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type RegisterSaveHandler = (
  path: string,
  handler: () => Promise<void>,
) => () => void;

export function useFilePreviewDocument({
  filePath,
  projectPath,
  active,
  registerSaveHandler,
  changedOnDiskError,
}: {
  filePath: string;
  projectPath: string;
  active: boolean;
  registerSaveHandler: RegisterSaveHandler;
  changedOnDiskError: string;
}) {
  const [textDocument, setTextDocument] = useState<TextDocumentState>(EMPTY_TEXT_DOCUMENT);
  const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diskReadError, setDiskReadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textDocumentRef = useRef<TextDocumentState>(EMPTY_TEXT_DOCUMENT);
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  const saveRequestedRef = useRef(false);
  const pendingWriteContentRef = useRef<string | null>(null);
  const hasLoadedContentRef = useRef(false);
  const diskUnavailableRef = useRef(false);
  const diskCheckGenerationRef = useRef(0);
  const aliveRef = useRef(true);

  const commitTextDocument = useCallback((next: TextDocumentState) => {
    textDocumentRef.current = next;
    setTextDocument(next);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    commitTextDocument(EMPTY_TEXT_DOCUMENT);
    setPreview(null);
    setError(null);
    setDiskReadError(null);
    setSaveStatus("idle");
    saveRequestedRef.current = false;
    hasLoadedContentRef.current = false;
    diskUnavailableRef.current = false;
    diskCheckGenerationRef.current += 1;

    const loadFile = invoke<unknown>("read_file_preview", {
      path: filePath,
      projectPath,
    }).then((value) => {
      if (cancelled) return;
      const nextPreview = decodeWorkspaceFilePreview(value);
      setPreview(nextPreview);
      if (nextPreview.kind === "text") {
        commitTextDocument(loadTextDocument(nextPreview.text));
      }
      hasLoadedContentRef.current = true;
      setLoading(false);
    });

    loadFile.catch((loadError) => {
      if (cancelled) return;
      setError(String(loadError));
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [commitTextDocument, filePath, projectPath]);

  const persistLatestContent = useCallback((): Promise<void> => {
    if (saveInFlightRef.current) {
      saveRequestedRef.current = true;
      return saveInFlightRef.current;
    }

    const run = async () => {
      do {
        saveRequestedRef.current = false;
        const snapshot = textDocumentRef.current;
        if (
          snapshot.content === null
          || snapshot.diskBaseline === null
          || snapshot.conflictDiskContent !== null
          || diskUnavailableRef.current
          || !textDocumentIsDirty(snapshot)
        ) return;

        if (savedResetRef.current) clearTimeout(savedResetRef.current);
        if (aliveRef.current) setSaveStatus("saving");
        pendingWriteContentRef.current = snapshot.content;
        const written = await invoke<boolean>("write_file_content_if_unchanged", {
          path: filePath,
          content: snapshot.content,
          expectedContent: snapshot.diskBaseline,
          projectPath,
        });
        // A successful compare-and-swap already tells us what the file holds:
        // exactly what was just written. Only a rejected write needs the disk
        // read, which keeps an autosave tick off the cost of re-reading the
        // whole file every 1.5 seconds.
        let diskContent: string;
        if (written) {
          diskContent = snapshot.content;
        } else {
          const diskPreview = decodeWorkspaceFilePreview(await invoke<unknown>("read_file_preview", {
            path: filePath,
            projectPath,
          }));
          if (diskPreview.kind !== "text") {
            throw new Error("The file is no longer editable text");
          }
          diskContent = diskPreview.text;
        }
        pendingWriteContentRef.current = null;

        const current = written
          ? completeTextSave(textDocumentRef.current, snapshot.content)
          : textDocumentRef.current;
        const reconciled = reconcileDiskTextDocument(current, diskContent);
        if (aliveRef.current) commitTextDocument(reconciled.document);
        else textDocumentRef.current = reconciled.document;
        if (reconciled.decision === "conflict") {
          saveRequestedRef.current = false;
          if (aliveRef.current) setSaveStatus("idle");
          return;
        }
        if (!written && textDocumentIsDirty(reconciled.document)) {
          if (aliveRef.current) setSaveStatus("idle");
          return;
        }
        if (aliveRef.current && !textDocumentIsDirty(reconciled.document)) {
          setSaveStatus("saved");
          savedResetRef.current = setTimeout(
            () => setSaveStatus("idle"),
            SAVED_STATUS_DURATION_MS,
          );
        }
      } while (saveRequestedRef.current);
    };

    const tracked = run()
      .catch((saveError) => {
        pendingWriteContentRef.current = null;
        if (aliveRef.current) setSaveStatus("error");
        throw saveError;
      })
      .finally(() => {
        if (saveInFlightRef.current === tracked) saveInFlightRef.current = null;
      });
    saveInFlightRef.current = tracked;
    return tracked;
  }, [commitTextDocument, filePath, projectPath]);

  const schedulePersist = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const current = textDocumentRef.current;
    if (
      current.conflictDiskContent !== null
      || diskUnavailableRef.current
      || !textDocumentIsDirty(current)
    ) {
      setSaveStatus("idle");
      return;
    }
    setSaveStatus("saving");
    saveTimerRef.current = setTimeout(
      () => void persistLatestContent().catch(() => undefined),
      AUTOSAVE_DELAY_MS,
    );
  }, [persistLatestContent]);

  const handleChange = useCallback((value: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (savedResetRef.current) clearTimeout(savedResetRef.current);
    commitTextDocument(editTextDocument(textDocumentRef.current, value));
    schedulePersist();
  }, [commitTextDocument, schedulePersist]);

  const saveNow = useCallback(() => {
    const current = textDocumentRef.current;
    if (
      preview?.kind !== "text"
      || current.content === null
      || current.conflictDiskContent !== null
      || diskUnavailableRef.current
    ) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    void persistLatestContent().catch(() => undefined);
  }, [persistLatestContent, preview?.kind]);

  const flushContent = useCallback(async () => {
    const current = textDocumentRef.current;
    if (current.content === null || preview?.kind !== "text" || !textDocumentIsDirty(current)) return;
    if (current.conflictDiskContent !== null || diskUnavailableRef.current) {
      throw new Error(changedOnDiskError);
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    await persistLatestContent();
  }, [changedOnDiskError, persistLatestContent, preview?.kind]);

  useEffect(
    () => registerSaveHandler(filePath, flushContent),
    [filePath, flushContent, registerSaveHandler],
  );

  const reloadFromDisk = useCallback(async ({
    discardLocalEdits = false,
  }: { discardLocalEdits?: boolean } = {}) => {
    const generation = ++diskCheckGenerationRef.current;
    try {
      const nextPreview = decodeWorkspaceFilePreview(await invoke<unknown>("read_file_preview", {
        path: filePath,
        projectPath,
      }));
      if (!aliveRef.current || generation !== diskCheckGenerationRef.current) return;
      setPreview(nextPreview);
      if (nextPreview.kind !== "text") {
        hasLoadedContentRef.current = true;
        diskUnavailableRef.current = false;
        setDiskReadError(null);
        setError(null);
        return;
      }
      const nextContent = nextPreview.text;
      const wasUnavailable = diskUnavailableRef.current;
      hasLoadedContentRef.current = true;
      diskUnavailableRef.current = false;
      setDiskReadError(null);
      setError(null);

      if (
        textDocumentRef.current.content === null
        || textDocumentRef.current.diskBaseline === null
      ) {
        commitTextDocument(loadTextDocument(nextContent));
        return;
      }

      const pendingWriteContent = pendingWriteContentRef.current;
      if (!discardLocalEdits && pendingWriteContent === nextContent) {
        commitTextDocument(completeTextSave(textDocumentRef.current, nextContent));
        return;
      }

      const wasConflicted = textDocumentRef.current.conflictDiskContent !== null;
      const reconciled = reconcileDiskTextDocument(
        textDocumentRef.current,
        nextContent,
        discardLocalEdits,
      );
      if (reconciled.decision === "not-ready") return;
      commitTextDocument(reconciled.document);

      if (reconciled.decision === "reload" || reconciled.decision === "conflict") {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveRequestedRef.current = false;
        setSaveStatus("idle");
      } else if (
        (wasConflicted || wasUnavailable)
        && textDocumentIsDirty(reconciled.document)
      ) {
        schedulePersist();
      }
    } catch (readError) {
      if (!aliveRef.current) return;
      if (!hasLoadedContentRef.current) {
        setError(String(readError));
        return;
      }
      diskUnavailableRef.current = true;
      setDiskReadError(String(readError));
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveRequestedRef.current = false;
      setSaveStatus("idle");
    }
  }, [commitTextDocument, filePath, projectPath, schedulePersist]);

  const keepLocalEdits = useCallback(() => {
    const kept = keepLocalTextEdits(textDocumentRef.current);
    if (kept === textDocumentRef.current) return;
    commitTextDocument(kept);
    if (textDocumentIsDirty(kept)) schedulePersist();
    else setSaveStatus("idle");
  }, [commitTextDocument, schedulePersist]);

  const checkDisk = useCallback(() => {
    void reloadFromDisk();
  }, [reloadFromDisk]);
  useFileDiskWatcher({
    active: active && !loading,
    filePath,
    projectPath,
    onCheckDisk: checkDisk,
  });

  // Read through refs so this stays a true unmount handler. Depending on the
  // values directly re-runs the cleanup whenever they change — and it runs with
  // the *previous* closure, so a file that stopped being text (replaced on disk
  // by an image, say) would still take the "flush the text" branch and write the
  // old buffer back over it.
  const previewKindRef = useRef(preview?.kind);
  const persistLatestContentRef = useRef(persistLatestContent);
  useEffect(() => {
    previewKindRef.current = preview?.kind;
  }, [preview?.kind]);
  useEffect(() => {
    persistLatestContentRef.current = persistLatestContent;
  }, [persistLatestContent]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (savedResetRef.current) clearTimeout(savedResetRef.current);
    const current = textDocumentRef.current;
    if (
      previewKindRef.current === "text"
      && !diskUnavailableRef.current
      && current.content !== null
      && current.diskBaseline !== null
      && current.conflictDiskContent === null
      && textDocumentIsDirty(current)
    ) {
      void persistLatestContentRef.current().catch(() => undefined);
    }
  }, []);

  return {
    content: textDocument.content,
    preview,
    error,
    diskReadError,
    loading,
    saveStatus,
    isDirty: textDocumentIsDirty(textDocument),
    externallyChanged: textDocument.conflictDiskContent !== null,
    handleChange,
    saveNow,
    reloadFromDisk,
    keepLocalEdits,
  };
}
