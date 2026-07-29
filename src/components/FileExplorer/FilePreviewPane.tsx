import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactCodeMirror, { EditorView } from "@uiw/react-codemirror";
import { useTranslation } from "react-i18next";
import { aegisCodeMirrorBaseTheme, getCodeMirrorColorTheme } from "@/utils/codeMirrorTheme";
import { FileReadOnlyPreview } from "./FileReadOnlyPreview";
import { FileUnavailableBanner } from "./FileUnavailableBanner";
import { MarkdownPreview, extractMarkdownHeadings } from "./MarkdownPreview";
import { MarkdownTableOfContents } from "./MarkdownTableOfContents";
import { FilePreviewStatusBar } from "./FilePreviewStatusBar";
import { isMakefile, parseMakeTargets } from "./fileViewerCapabilities";
import { resolveMarkdownResourcePath } from "./fileViewerModel";
import type { ThemeVariant } from "./fileViewerTypes";
import { useWorkspaceFileDocument } from "./useWorkspaceFileDocument";

interface FilePreviewPaneProps {
  filePath: string;
  fileName: string;
  projectPath: string;
  ownerId: string;
  themeVariant: ThemeVariant;
  active: boolean;
  previewMode: boolean;
  tableOfContentsVisible: boolean;
  wordWrap: boolean;
  onRunMakeTarget?: (target: string) => void;
  onFileMissing?: (path: string) => void;
  onDirtyChange?: (path: string, dirty: boolean) => void;
  onOpenFile: (path: string, name: string) => void;
  onCloseTableOfContents: () => void;
  onTableOfContentsAvailabilityChange: (path: string, available: boolean) => void;
}

export function FilePreviewPane({
  filePath,
  fileName,
  projectPath,
  ownerId,
  themeVariant,
  active,
  previewMode,
  tableOfContentsVisible,
  wordWrap,
  onRunMakeTarget,
  onFileMissing,
  onDirtyChange,
  onOpenFile,
  onCloseTableOfContents,
  onTableOfContentsAvailabilityChange,
}: FilePreviewPaneProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const {
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
  } = useWorkspaceFileDocument({
    filePath,
    fileName,
    projectPath,
    ownerId,
    previewMode,
    onFileMissing,
    onDirtyChange,
  });

  const headings = useMemo(
    () => isMarkdown && content !== null ? extractMarkdownHeadings(content) : [],
    [content, isMarkdown],
  );
  const makeTargets = useMemo(
    () => isMakefile(fileName) && content ? parseMakeTargets(content) : [],
    [content, fileName],
  );
  const extensions = useMemo(
    () => [
      languageExtension,
      aegisCodeMirrorBaseTheme,
      ...(wordWrap ? [EditorView.lineWrapping] : []),
    ],
    [languageExtension, wordWrap],
  );

  useEffect(() => {
    onTableOfContentsAvailabilityChange(filePath, headings.length > 0);
  }, [filePath, headings.length, onTableOfContentsAvailabilityChange]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void saveNow();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, saveNow]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !active || !previewMode || headings.length === 0) return;
    const headingElements = headings
      .map((heading) => root.querySelector<HTMLElement>(`#${CSS.escape(heading.id)}`))
      .filter((element): element is HTMLElement => element !== null);
    const observer = new IntersectionObserver((entries) => {
      const firstVisible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
      if (firstVisible) setActiveHeadingId(firstVisible.target.id);
    }, { root, rootMargin: "0px 0px -65% 0px", threshold: 0 });
    headingElements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [active, headings, previewMode]);

  const openLocalMarkdownLink = useCallback((href: string) => {
    const path = resolveMarkdownResourcePath(href, filePath, projectPath);
    const name = path?.split(/[\\/]/).pop();
    if (path && name) onOpenFile(path, name);
  }, [filePath, onOpenFile, projectPath]);

  const statusLabel = readOnlyPreview
    ? `${readOnlyPreview.mimeType ?? readOnlyPreview.kind} - ${t("file.readOnly", "Read-only")}`
    : snapshot?.status === "conflicted"
      ? t("file.changedOnDisk", "Changed on disk - your unsaved edits are kept")
      : snapshot?.status === "saving"
        ? t("file.saving", "Saving...")
        : snapshot?.status === "saved"
          ? t("file.saved", "Saved")
          : snapshot?.status === "error"
            ? t("file.saveFailed", "Save failed")
            : null;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, minHeight: 0 }}>
      {diskReadError ? <FileUnavailableBanner onRetry={() => void reloadFromDisk()} /> : null}
      <div style={{ flex: 1, overflow: "hidden", position: "relative", minWidth: 0, minHeight: 0 }}>
        {loading ? (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--aegis-text-dim)", fontSize: 12 }}>
            {t("common.loading", "Loading...")}
          </div>
        ) : error ? (
          <div style={{ height: "100%", display: "grid", placeItems: "center", color: "var(--aegis-text-muted)", fontSize: 12.5 }}>
            {error}
          </div>
        ) : readOnlyPreview ? (
          <FileReadOnlyPreview preview={readOnlyPreview} fileName={fileName} filePath={filePath} projectPath={projectPath} />
        ) : content !== null && isMarkdown && previewMode ? (
          <>
            <div ref={scrollRef} className="md-preview-scroll">
              <MarkdownPreview content={content} onOpenLocalLink={openLocalMarkdownLink} />
            </div>
            {tableOfContentsVisible && headings.length > 0 ? (
              <MarkdownTableOfContents
                headings={headings}
                activeId={activeHeadingId}
                onNavigate={(id) => scrollRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                onClose={onCloseTableOfContents}
              />
            ) : null}
          </>
        ) : content !== null ? (
          <ReactCodeMirror
            value={content}
            onChange={edit}
            theme={getCodeMirrorColorTheme(themeVariant)}
            extensions={extensions}
            height="100%"
            style={{ height: "100%" }}
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              highlightActiveLine: true,
              highlightSelectionMatches: true,
              autocompletion: false,
              searchKeymap: true,
            }}
          />
        ) : null}
      </div>
      <FilePreviewStatusBar
        filePath={filePath}
        makeTargets={makeTargets}
        status={snapshot?.status ?? null}
        statusLabel={statusLabel}
        retrySaveDisabled={Boolean(diskReadError)}
        onRunMakeTarget={onRunMakeTarget}
        onRetrySave={() => void saveNow()}
      />
    </div>
  );
}
