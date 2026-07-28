// FileViewer — Code editor + markdown preview + media viewer

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import { useTranslation } from "react-i18next";
import { Eye, MoreHorizontal, Pencil, Play, Save, X } from "lucide-react";
import ReactCodeMirror from "@uiw/react-codemirror";
import type { Extension } from "@codemirror/state";
import { loadCodeMirrorLanguage } from "@/utils/codeMirrorLanguages";
import { aegisCodeMirrorBaseTheme, getCodeMirrorColorTheme } from "@/utils/codeMirrorTheme";
import { pathIsTargetOrDescendant } from "./openFilePaths";
import { isMarkdownFile } from "@/utils/filePreviewCapabilities";
import { ExternalFileChangeBanner } from "./ExternalFileChangeBanner";
import { FileUnavailableBanner } from "./FileUnavailableBanner";
import { FileReadOnlyPreview } from "./FileReadOnlyPreview";
import {
  useFilePreviewDocument,
  type RegisterSaveHandler,
} from "./useFilePreviewDocument";

// ── Types ────────────────────────────────────────────────────────────────────

export interface OpenFileTab {
  path: string;
  name: string;
}

export interface FileViewerHandle {
  flushPath: (path: string, isDirectory: boolean) => Promise<void>;
}

export type ThemeVariant = "dark" | "midnight" | "light" | "eyecare";

type TocEntry = { depth: number; text: string; id: string };

// ── File helpers ─────────────────────────────────────────────────────────────

function isMakefile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  // Plain "Makefile" / "makefile" / "GNUmakefile", or any *.mk / *.make.
  if (
    lower === "makefile" ||
    lower === "gnumakefile" ||
    lower === "bsdmakefile" ||
    lower === "makefile.in"
  ) {
    return true;
  }
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext === "mk" || ext === "make";
}

/**
 * Parse the first chunk of a Makefile and return its top-level targets.
 *
 * Heuristics:
 * - Skip comment lines (`#`) and recipe lines (lines that start with a tab).
 * - Skip variable assignments (lines containing `=` before `:`).
 * - Skip `.PHONY` / `.SUFFIXES` etc. — those aren't runnable targets.
 * - Stop after `MAX_TARGETS` matches so a 10 MB generated Makefile
 *   doesn't lock up the UI.
 */
const MAX_TARGETS = 32;
function parseMakeTargets(content: string): string[] {
  const out: string[] = [];
  const lines = content.split(/\r?\n/);
  // Match lines like:  foo: deps...    or    foo bar: deps...   (multi-target)
  const targetRe = /^([A-Za-z0-9_./-]+(?:\s+[A-Za-z0-9_./-]+)*)\s*:(?!=)/;
  for (const raw of lines) {
    if (out.length >= MAX_TARGETS) break;
    const line = raw.replace(/\\\r?\n$/, ""); // join line-continuations
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (line.startsWith("\t") || line.startsWith("    ")) continue; // recipe body
    if (/^\.[A-Z][A-Z0-9_]*\s*[:?]?=/.test(line.trim())) continue; // .PHONY, .SUFFIXES, vars
    if (line.includes("=") && !line.includes(":")) continue; // var assignment only
    const m = line.match(targetRe);
    if (!m) continue;
    const names = m[1].trim().split(/\s+/);
    for (const n of names) {
      if (!n || n.startsWith(".") || n === "$") continue;
      if (!out.includes(n)) out.push(n);
      if (out.length >= MAX_TARGETS) break;
    }
  }
  return out;
}

// ── Markdown rendering ───────────────────────────────────────────────────────

function renderMarkdownWithToc(content: string): { html: string; toc: TocEntry[] } {
  const used = new Set<string>();
  const toc: TocEntry[] = [];
  const instance = new Marked({
    renderer: {
      heading(token) {
        const inlineHtml = this.parser.parseInline(token.tokens);
        const plain = inlineHtml.replace(/<[^>]*>/g, "").trim();
        const base =
          plain
            .toLowerCase()
            .replace(/[^\w一-鿿 -]/g, "")
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-+|-+$/g, "") || "section";
        let id = base;
        let n = 1;
        while (used.has(id)) id = `${base}-${n++}`;
        used.add(id);
        toc.push({ depth: token.depth, text: plain, id });
        return `<h${token.depth} id="${id}">${inlineHtml}</h${token.depth}>\n`;
      },
    },
  });
  const html = instance.parse(content, { async: false }) as string;
  return { html: DOMPurify.sanitize(html), toc };
}

// ── Tab color helper ─────────────────────────────────────────────────────────

function getFileColor(name: string): string {
  const n = name.toLowerCase();
  if (n === "dockerfile" || n.startsWith("dockerfile.")) return "#0db7ed";
  if (n === "makefile" || n === "gnumakefile" || n === "justfile") return "#bf7a00";
  if (n.startsWith(".git") || n.startsWith(".docker") || n === ".editorconfig" || n === ".npmrc")
    return "#8b949e";
  if (n === ".env" || n.startsWith(".env.")) return "#8b949e";

  const e = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  switch (e) {
    case "ts":
    case "tsx":
      return "#3178c6";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "#f0db4f";
    case "json":
    case "jsonc":
      return "#f0db4f";
    case "rs":
      return "#dea584";
    case "py":
      return "#3572a5";
    case "go":
      return "#00add8";
    case "html":
    case "htm":
      return "#e34c26";
    case "css":
    case "scss":
    case "sass":
      return "#563d7c";
    case "md":
    case "mdx":
      return "#083fa1";
    case "yaml":
    case "yml":
      return "#cb171e";
    case "toml":
      return "#9c4221";
    case "sh":
    case "bash":
      return "#89e051";
    default:
      return "rgb(var(--aegis-text-dim))";
  }
}

// ── Markdown TOC ─────────────────────────────────────────────────────────────

function MarkdownToc({
  toc,
  activeId,
  onJump,
}: {
  toc: TocEntry[];
  activeId: string | null;
  onJump: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const minDepth = useMemo(() => Math.min(...toc.map((e) => e.depth)), [toc]);

  return (
    <div
      style={{
        position: "absolute",
        right: 8,
        top: 8,
        maxWidth: "min(220px, calc(100% - 16px))",
        maxHeight: "calc(100% - 16px)",
        overflowY: "auto",
        background: "var(--aegis-elevated)",
        border: "1px solid var(--aegis-border)",
        borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0,0,0,0.24)",
        zIndex: 50,
        opacity: open ? 1 : undefined,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "6px 10px",
          border: "none",
          borderBottom: open ? "1px solid var(--aegis-border)" : "none",
          background: "transparent",
          color: "rgb(var(--aegis-text-dim))",
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "var(--font-ui, var(--font-sans))",
          textAlign: "left",
        }}
      >
        {t("file.outline", "Outline")}
      </button>
      {open && (
        <nav style={{ padding: "4px 0" }}>
          {toc.map((entry) => (
            <button
              key={entry.id}
              type="button"
              data-depth={Math.min(entry.depth - minDepth + 1, 6)}
              onClick={() => onJump(entry.id)}
              title={entry.text}
              style={{
                display: "block",
                width: "100%",
                padding: "2px 10px",
                paddingLeft: 10 + (entry.depth - minDepth) * 12,
                border: "none",
                background:
                  activeId === entry.id
                    ? "rgb(var(--aegis-primary) / 0.12)"
                    : "transparent",
                color:
                  activeId === entry.id
                    ? "rgb(var(--aegis-primary))"
                    : "rgb(var(--aegis-text-muted))",
                fontSize: 11.5,
                textAlign: "left",
                cursor: "pointer",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: "var(--font-ui, var(--font-sans))",
              }}
            >
              {entry.text}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

// ── FilePreviewPane ──────────────────────────────────────────────────────────

function FilePreviewPane({
  filePath,
  fileName,
  projectPath,
  themeVariant,
  previewMode,
  active,
  registerSaveHandler,
  onRunMakeTarget,
}: {
  filePath: string;
  fileName: string;
  projectPath: string;
  themeVariant: ThemeVariant;
  previewMode: boolean;
  active: boolean;
  registerSaveHandler: RegisterSaveHandler;
  onRunMakeTarget?: (target: string) => void;
}) {
  const editorTheme = getCodeMirrorColorTheme(themeVariant);
  const { t } = useTranslation();
  const isMarkdown = isMarkdownFile(fileName);
  const {
    content,
    preview,
    error,
    diskReadError,
    loading,
    saveStatus,
    isDirty,
    externallyChanged,
    handleChange,
    saveNow: handleSaveNow,
    reloadFromDisk,
    keepLocalEdits,
  } = useFilePreviewDocument({
    filePath,
    projectPath,
    active,
    registerSaveHandler,
    changedOnDiskError: t("file.changedOnDisk", "File changed on disk"),
  });
  const isTextPreview = preview?.kind === "text";
  const readOnlyPreview = preview && preview.kind !== "text" ? preview : null;
  const [languageExtension, setLanguageExtension] = useState<Extension>([]);
  const isMake = isMakefile(fileName);
  const makeTargets = useMemo(
    () => (isMake && content ? parseMakeTargets(content) : []),
    [isMake, content],
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const showMarkdownPreview = isMarkdown && previewMode && content !== null;
  const { html: markdownHtml, toc } = useMemo(
    () =>
      isMarkdown && content !== null
        ? renderMarkdownWithToc(content)
        : { html: "", toc: [] },
    [isMarkdown, content],
  );

  const jumpToHeading = useCallback((id: string) => {
    const target = scrollRef.current?.querySelector<HTMLElement>(
      `#${CSS.escape(id)}`,
    );
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Intersection observer for active TOC heading
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !showMarkdownPreview || toc.length === 0) return;
    const headings = toc
      .map((entry) => root.querySelector<HTMLElement>(`#${CSS.escape(entry.id)}`))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveHeadingId(visible[0].target.id);
      },
      { root, rootMargin: "0px 0px -65% 0px", threshold: 0 },
    );
    headings.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [showMarkdownPreview, toc]);

  useEffect(() => {
    let alive = true;
    setLanguageExtension([]);
    if (!isTextPreview || (isMarkdown && previewMode)) return;
    loadCodeMirrorLanguage(fileName)
      .then((extension) => {
        if (alive) setLanguageExtension(extension);
      })
      .catch(() => {
        if (alive) setLanguageExtension([]);
      });
    return () => {
      alive = false;
    };
  }, [fileName, isMarkdown, isTextPreview, previewMode]);

  useEffect(() => {
    if (!active || !isTextPreview || content === null || previewMode) return;
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        handleSaveNow();
      }
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [active, content, handleSaveNow, isTextPreview, previewMode]);

  const extensions = useMemo(
    () => [languageExtension, aegisCodeMirrorBaseTheme],
    [languageExtension],
  );

  const saveLabel =
    saveStatus === "saving"
      ? t("file.saving", "Saving...")
      : saveStatus === "saved"
        ? t("file.saved", "Saved")
        : saveStatus === "error"
          ? t("file.saveFailed", "Save failed")
          : null;

  const statusLabel = diskReadError
    ? t("file.unavailableOnDisk", "Unavailable on disk")
    : readOnlyPreview
      ? `${readOnlyPreview.mimeType ?? t("file.binaryFile", "Binary file")} - ${t("file.readOnly", "Read-only")}`
      : externallyChanged
        ? t("file.changedOnDisk", "Changed on disk")
        : saveLabel ?? (previewMode ? t("file.previewing", "Preview") : t("file.editing", "Editing"));

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minWidth: 0,
        minHeight: 0,
        background: "var(--aegis-elevated)",
      }}
    >
      {diskReadError ? (
        <FileUnavailableBanner onRetry={() => void reloadFromDisk()} />
      ) : externallyChanged ? (
        <ExternalFileChangeBanner
          onReload={() => void reloadFromDisk({ discardLocalEdits: true })}
          onKeepEdits={keepLocalEdits}
        />
      ) : null}

      {/* Content area */}
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          position: "relative",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        {loading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgb(var(--aegis-text-dim))",
              fontSize: 12,
            }}
          >
            {t("common.loading", "Loading...")}
          </div>
        )}
        {error && !loading && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 10,
              color: "rgb(var(--aegis-text-muted))",
            }}
          >
            <span style={{ fontSize: 12.5 }}>{error}</span>
          </div>
        )}
        {!loading &&
          !error &&
          (readOnlyPreview ? (
            <FileReadOnlyPreview
              preview={readOnlyPreview}
              fileName={fileName}
              filePath={filePath}
              projectPath={projectPath}
            />
          ) : content !== null ? (
            isMarkdown && previewMode ? (
              <>
                <div ref={scrollRef} className="md-preview-scroll">
                  <div
                    className="md-preview"
                    dangerouslySetInnerHTML={{ __html: markdownHtml }}
                  />
                </div>
                {toc.length > 0 && (
                  <MarkdownToc
                    toc={toc}
                    activeId={activeHeadingId}
                    onJump={jumpToHeading}
                  />
                )}
              </>
            ) : (
              <ReactCodeMirror
                value={content}
                onChange={handleChange}
                theme={editorTheme}
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
            )
          ) : null)}
      </div>

      {/* Status bar */}
      <div
        style={{
          height: 22,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          borderTop: "1px solid var(--aegis-border)",
          background: "var(--aegis-surface)",
          flexShrink: 0,
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: "rgb(var(--aegis-text-muted))",
            fontFamily: "var(--font-ui, var(--font-sans))",
          }}
        >
          {filePath}
        </span>
        {/* Makefile target run buttons — only when we parsed targets */}
        {isMake && makeTargets.length > 0 && onRunMakeTarget && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
              marginLeft: 12,
              paddingLeft: 12,
              borderLeft: "1px solid var(--aegis-border)",
              maxHeight: 28,
              overflowY: "auto",
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "rgb(var(--aegis-text-dim))",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                alignSelf: "center",
                marginRight: 4,
              }}
            >
              {t("file.makeTargets", "Make")}
            </span>
            {makeTargets.map((target) => (
              <button
                key={target}
                type="button"
                onClick={() => onRunMakeTarget(target)}
                title={`Run \`make ${target}\` in the project terminal`}
                style={{
                  fontSize: 10.5,
                  fontFamily: "var(--font-editor, var(--font-mono))",
                  padding: "2px 8px",
                  borderRadius: 4,
                  border: "1px solid var(--aegis-border)",
                  background: "var(--aegis-surface)",
                  color: "rgb(var(--aegis-text-secondary))",
                  cursor: "pointer",
                  lineHeight: 1.4,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--aegis-accent)";
                  e.currentTarget.style.color = "rgb(var(--aegis-text))";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--aegis-surface)";
                  e.currentTarget.style.color = "rgb(var(--aegis-text-secondary))";
                }}
              >
                <Play size={10} aria-hidden="true" />
                {target}
              </button>
            ))}
          </div>
        )}
        {statusLabel && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11,
              color:
                saveStatus === "error"
                  ? "var(--aegis-danger)"
                  : "rgb(var(--aegis-text-muted))",
              fontFamily: "var(--font-ui, var(--font-sans))",
            }}
          >
            {statusLabel}
          </span>
        )}
        {isTextPreview && content !== null && !previewMode && (
          <button
            type="button"
            onClick={handleSaveNow}
            disabled={
              Boolean(diskReadError)
              || externallyChanged
              || (!isDirty && saveStatus !== "error")
            }
            title={t("file.saveNow", "Save (Ctrl/Cmd+S)")}
            aria-label={t("file.saveNow", "Save (Ctrl/Cmd+S)")}
            className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text disabled:cursor-default disabled:opacity-35"
          >
            <Save size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── FileViewer ───────────────────────────────────────────────────────────────

export const FileViewer = forwardRef<FileViewerHandle, {
  tabs: OpenFileTab[];
  activeFilePath: string | null;
  projectPath: string;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onCloseOtherTabs: (path: string) => void;
  onCloseTabsToRight: (path: string) => void;
  onCloseTabsToLeft: (path: string) => void;
  onCloseAllTabs: () => void;
  themeVariant?: ThemeVariant;
  onRunMakeTarget?: (target: string) => void;
}>(function FileViewer({
  tabs,
  activeFilePath,
  projectPath,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onCloseTabsToLeft,
  onCloseAllTabs,
  themeVariant = "dark",
  onRunMakeTarget,
}, ref) {
  const { t } = useTranslation();
  const [previewModes, setPreviewModes] = useState<Record<string, boolean>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [tabMenu, setTabMenu] = useState<{
    x: number;
    y: number;
    path: string;
  } | null>(null);
  const tabMenuRef = useRef<HTMLDivElement | null>(null);
  const saveHandlersRef = useRef(new Map<string, () => Promise<void>>());
  const [tabMenuPos, setTabMenuPos] = useState<{
    left: number;
    top: number;
  } | null>(null);

  const registerSaveHandler = useCallback<RegisterSaveHandler>((path, handler) => {
    saveHandlersRef.current.set(path, handler);
    return () => {
      if (saveHandlersRef.current.get(path) === handler) saveHandlersRef.current.delete(path);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    flushPath: async (path, isDirectory) => {
      const handlers = [...saveHandlersRef.current.entries()]
        .filter(([openPath]) => pathIsTargetOrDescendant(openPath, path, isDirectory))
        .map(([, handler]) => handler());
      await Promise.all(handlers);
    },
  }), []);

  // Clamp menu to viewport
  useLayoutEffect(() => {
    if (!tabMenu || !tabMenuRef.current) return;
    const { width, height } = tabMenuRef.current.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(
      margin,
      Math.min(tabMenu.x, window.innerWidth - width - margin),
    );
    const top = Math.max(
      margin,
      Math.min(tabMenu.y, window.innerHeight - height - margin),
    );
    setTabMenuPos({ left, top });
  }, [tabMenu]);

  // Dismiss tab menu
  useEffect(() => {
    if (!tabMenu) return;
    const dismiss = (event: Event) => {
      if (
        event.target instanceof Node &&
        tabMenuRef.current?.contains(event.target)
      )
        return;
      setTabMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTabMenu(null);
    };
    const close = () => setTabMenu(null);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [tabMenu]);

  useEffect(() => {
    setPreviewModes((prev) => {
      const next: Record<string, boolean> = {};
      for (const tab of tabs) {
        if (Object.prototype.hasOwnProperty.call(prev, tab.path)) next[tab.path] = prev[tab.path];
      }
      return Object.keys(next).length === Object.keys(prev).length
        ? prev
        : next;
    });
  }, [tabs]);

  const activeTab = useMemo(
    () =>
      tabs.find((tab) => tab.path === activeFilePath) ??
      tabs[tabs.length - 1] ??
      null,
    [tabs, activeFilePath],
  );

  if (!activeTab) return null;

  const activeIsMarkdown = isMarkdownFile(activeTab.name);
  const activePreviewMode = activeIsMarkdown && (previewModes[activeTab.path] ?? true);
  const canCloseOtherTabs = tabs.length > 1;
  const activeTabIndex = tabs.findIndex((tab) => tab.path === activeTab.path);
  const canCloseTabsToRight =
    activeTabIndex !== -1 && activeTabIndex < tabs.length - 1;
  const canCloseTabsToLeft = activeTabIndex > 0;

  const tabMenuIndex = tabMenu
    ? tabs.findIndex((tab) => tab.path === tabMenu.path)
    : -1;
  const tabMenuCanCloseOthers = tabs.length > 1;
  const tabMenuCanCloseRight =
    tabMenuIndex !== -1 && tabMenuIndex < tabs.length - 1;
  const tabMenuCanCloseLeft = tabMenuIndex > 0;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minWidth: 0,
        minHeight: 0,
        background: "var(--aegis-elevated)",
      }}
    >
      {/* Tab strip */}
      <div
        style={{
          height: 40,
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid var(--aegis-border)",
          flexShrink: 0,
          background: "var(--aegis-surface)",
          minWidth: 0,
        }}
      >
        <div
          className="file-viewer-tab-strip"
          style={{
            flex: 1,
            minWidth: 0,
            height: "100%",
            display: "flex",
            alignItems: "stretch",
            overflowX: "auto",
            overflowY: "hidden",
            paddingLeft: 4,
          }}
        >
          {tabs.map((tab) => {
            const isActive = tab.path === activeTab.path;
            const fileColor = getFileColor(tab.name);
            return (
              <button
                key={tab.path}
                onClick={() => onSelectTab(tab.path)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenuOpen(false);
                  setTabMenuPos(null);
                  setTabMenu({
                    x: event.clientX,
                    y: event.clientY,
                    path: tab.path,
                  });
                }}
                title={tab.path}
                style={{
                  height: "100%",
                  minWidth: 0,
                  maxWidth: 220,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 10px 0 12px",
                  border: "none",
                  borderRight: "1px solid var(--aegis-border)",
                  borderTop: isActive
                    ? "2px solid rgb(var(--aegis-primary))"
                    : "2px solid transparent",
                  background: isActive
                    ? "var(--aegis-elevated)"
                    : "transparent",
                  fontSize: 12.5,
                  fontWeight: isActive ? 500 : 400,
                  color: isActive
                    ? "rgb(var(--aegis-text))"
                    : "rgb(var(--aegis-text-secondary))",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 14,
                    borderRadius: 2,
                    background: fileColor,
                    flexShrink: 0,
                    display: "inline-block",
                  }}
                />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {tab.name}
                </span>
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.path);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "2px",
                    borderRadius: 3,
                    display: "flex",
                    alignItems: "center",
                    color: "rgb(var(--aegis-text-dim))",
                    marginLeft: 2,
                  }}
                  role="button"
                  aria-label={t("file.closeTab", { name: tab.name })}
                >
                  <X size={12} />
                </span>
              </button>
            );
          })}
        </div>

        {/* Toggle preview/edit for markdown */}
        <div
          style={{
            marginLeft: 8,
            marginRight: 8,
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
          }}
        >
          {activeIsMarkdown && (
            <button
              onClick={() =>
                setPreviewModes((prev) => ({
                  ...prev,
                  [activeTab.path]: !(prev[activeTab.path] ?? true),
                }))
              }
              title={
                activePreviewMode
                  ? t("common.edit", "Edit")
                  : t("common.preview", "Preview")
              }
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "3px 8px",
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                gap: 4,
                color: activePreviewMode
                  ? "rgb(var(--aegis-primary))"
                  : "rgb(var(--aegis-text-dim))",
                fontSize: 11.5,
                fontFamily: "var(--font-ui, var(--font-sans))",
                flexShrink: 0,
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "var(--aegis-hover)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "none")
              }
            >
              {activePreviewMode ? <Pencil size={13} /> : <Eye size={13} />}
              {activePreviewMode ? t("common.edit", "Edit") : t("common.preview", "Preview")}
            </button>
          )}

          {/* More tab actions */}
          <div style={{ position: "relative" }}>
            <button
              title={t("file.tabActions", "Tab actions")}
              aria-label={t("file.tabActions", "Tab actions")}
              onClick={() => setMenuOpen((prev) => !prev)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px",
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                color: "rgb(var(--aegis-text-dim))",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "var(--aegis-hover)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "none")
              }
            >
              <MoreHorizontal size={15} />
            </button>
            {menuOpen && (
              <>
                <div
                  style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 199,
                  }}
                  onClick={() => setMenuOpen(false)}
                />
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "100%",
                    marginTop: 4,
                    zIndex: 200,
                    background: "var(--aegis-menu-bg)",
                    border: "1px solid var(--aegis-menu-border)",
                    borderRadius: 8,
                    boxShadow:
                      "0 8px 32px rgba(0,0,0,0.32)",
                    minWidth: 160,
                    padding: "4px 0",
                    fontSize: 12,
                    color: "rgb(var(--aegis-menu-text))",
                  }}
                >
                  <TabMenuItem
                    label={t("file.closeOtherTabs", "Close Other Tabs")}
                    disabled={!canCloseOtherTabs}
                    onClick={() => {
                      onCloseOtherTabs(activeTab.path);
                      setMenuOpen(false);
                    }}
                  />
                  <TabMenuItem
                    label={t("file.closeTabsToRight", "Close Tabs to the Right")}
                    disabled={!canCloseTabsToRight}
                    onClick={() => {
                      onCloseTabsToRight(activeTab.path);
                      setMenuOpen(false);
                    }}
                  />
                  <TabMenuItem
                    label={t("file.closeTabsToLeft", "Close Tabs to the Left")}
                    disabled={!canCloseTabsToLeft}
                    onClick={() => {
                      onCloseTabsToLeft(activeTab.path);
                      setMenuOpen(false);
                    }}
                  />
                  <TabMenuItem
                    label={t("file.closeAllTabs", "Close All Tabs")}
                    disabled={tabs.length === 0}
                    onClick={() => {
                      onCloseAllTabs();
                      setMenuOpen(false);
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content panes */}
      <div
        style={{
          flex: 1,
          position: "relative",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.path === activeTab.path;
          return (
            <div
              key={tab.path}
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                visibility: isActive ? "visible" : "hidden",
                pointerEvents: isActive ? "auto" : "none",
              }}
            >
              <FilePreviewPane
                filePath={tab.path}
                fileName={tab.name}
                projectPath={projectPath}
                themeVariant={themeVariant}
                previewMode={isMarkdownFile(tab.name) && (previewModes[tab.path] ?? true)}
                active={isActive}
                registerSaveHandler={registerSaveHandler}
                onRunMakeTarget={onRunMakeTarget}
              />
            </div>
          );
        })}
      </div>

      {/* Right-click tab context menu */}
      {tabMenu && tabMenuIndex !== -1 && createPortal(
        <div
          ref={tabMenuRef}
          style={{
            position: "fixed",
            left: tabMenuPos?.left ?? tabMenu.x,
            top: tabMenuPos?.top ?? tabMenu.y,
            visibility: tabMenuPos ? "visible" : "hidden",
            zIndex: 2147483001,
            background: "var(--aegis-menu-bg)",
            border: "1px solid var(--aegis-menu-border)",
            borderRadius: 8,
            boxShadow: "0 8px 32px rgba(0,0,0,0.32)",
            minWidth: 160,
            padding: "4px 0",
            fontSize: 12,
            color: "rgb(var(--aegis-menu-text))",
          }}
        >
          <TabMenuItem
            label={t("file.closeThisTab", "Close")}
            onClick={() => {
              onCloseTab(tabMenu.path);
              setTabMenu(null);
            }}
          />
          <TabMenuItem
            label={t("file.closeOtherTabs", "Close Other Tabs")}
            disabled={!tabMenuCanCloseOthers}
            onClick={() => {
              onCloseOtherTabs(tabMenu.path);
              setTabMenu(null);
            }}
          />
          <TabMenuItem
            label={t("file.closeTabsToRight", "Close Tabs to the Right")}
            disabled={!tabMenuCanCloseRight}
            onClick={() => {
              onCloseTabsToRight(tabMenu.path);
              setTabMenu(null);
            }}
          />
          <TabMenuItem
            label={t("file.closeTabsToLeft", "Close Tabs to the Left")}
            disabled={!tabMenuCanCloseLeft}
            onClick={() => {
              onCloseTabsToLeft(tabMenu.path);
              setTabMenu(null);
            }}
          />
          <TabMenuItem
            label={t("file.closeAllTabs", "Close All Tabs")}
            disabled={tabs.length === 0}
            onClick={() => {
              onCloseAllTabs();
              setTabMenu(null);
            }}
          />
        </div>,
        document.body,
      )}
    </div>
  );
});

// ── TabMenuItem ──────────────────────────────────────────────────────────────

function TabMenuItem({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "block",
        width: "calc(100% - 8px)",
        height: 28,
        padding: "0 10px",
        cursor: disabled ? "default" : "pointer",
        whiteSpace: "nowrap",
        borderRadius: 4,
        margin: "1px 4px",
        border: "none",
        textAlign: "left",
        fontSize: 12,
        fontFamily: "var(--font-ui, var(--font-sans))",
        color: disabled
          ? "var(--aegis-text-dim)"
          : "rgb(var(--aegis-menu-text))",
        background: "transparent",
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = "var(--aegis-menu-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {label}
    </button>
  );
}
