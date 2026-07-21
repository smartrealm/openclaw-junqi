// ═══════════════════════════════════════════════════════════
// FileViewer — Code editor + markdown preview + media viewer
// Ported from junqi with --aegis-* CSS var rewrites.
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Play, X } from "lucide-react";
import ReactCodeMirror, { EditorView } from "@uiw/react-codemirror";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import { solarizedLight } from "@uiw/codemirror-theme-solarized";
import type { Extension } from "@codemirror/state";
import { loadCodeMirrorLanguage } from "@/utils/codeMirrorLanguages";

// ── Types ────────────────────────────────────────────────────────────────────

export interface OpenFileTab {
  path: string;
  name: string;
}

type ThemeVariant = "dark" | "midnight" | "light" | "eyecare";

type SaveStatus = "idle" | "saving" | "saved" | "error";

type TocEntry = { depth: number; text: string; id: string };

type ImagePreviewData = {
  dataUrl: string;
  mimeType: string;
  byteLength: number;
};

// ── File helpers ─────────────────────────────────────────────────────────────

function isMarkdownFile(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext === "md" || ext === "mdx" || ext === "markdown";
}

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

function isPreviewableImageFile(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return (
    ext === "png" ||
    ext === "jpg" ||
    ext === "jpeg" ||
    ext === "gif" ||
    ext === "webp" ||
    ext === "bmp" ||
    ext === "svg"
  );
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

// ── Editor base theme (rewritten to --aegis-* vars) ──────────────────────────

const editorBaseTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontFamily: "var(--aegis-body)",
    fontSize: "13px",
    background: "var(--aegis-elevated)",
  },
  ".cm-editor": {
    background: "var(--aegis-elevated)",
  },
  ".cm-scroller": {
    overflow: "auto",
    lineHeight: "1.6",
    background: "var(--aegis-elevated)",
  },
  ".cm-content": {
    padding: "12px 0",
    caretColor: "var(--aegis-text)",
    color: "var(--aegis-text)",
  },
  ".cm-gutters": {
    borderRight: "1px solid var(--aegis-border)",
    background: "var(--aegis-surface)",
    fontSize: "12px",
    minWidth: "44px",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 8px 0 4px",
    color: "var(--aegis-text-dim)",
  },
  ".cm-activeLineGutter": {
    background: "rgb(var(--aegis-overlay) / 0.06)",
  },
  ".cm-focused .cm-activeLine, .cm-activeLine": {
    background: "rgb(var(--aegis-overlay) / 0.06)",
  },
});

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
      return "var(--aegis-text-dim)";
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
  const [open, setOpen] = useState(true);
  const minDepth = useMemo(() => Math.min(...toc.map((e) => e.depth)), [toc]);

  return (
    <div
      style={{
        position: "absolute",
        right: 8,
        top: 8,
        maxWidth: 220,
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
          color: "var(--aegis-text-dim)",
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "var(--aegis-body)",
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
                    ? "var(--aegis-primary)"
                    : "var(--aegis-text-muted)",
                fontSize: 11.5,
                textAlign: "left",
                cursor: "pointer",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: "var(--aegis-body)",
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
  onRunMakeTarget,
}: {
  filePath: string;
  fileName: string;
  projectPath: string;
  themeVariant: ThemeVariant;
  previewMode: boolean;
  onRunMakeTarget?: (target: string) => void;
}) {
  const editorTheme =
    themeVariant === "dark" || themeVariant === "midnight"
      ? githubDark
      : themeVariant === "eyecare"
        ? solarizedLight
        : githubLight;
  const { t } = useTranslation();
  const [content, setContent] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<ImagePreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [languageExtension, setLanguageExtension] = useState<Extension>([]);
  const isMarkdown = isMarkdownFile(fileName);
  const isPreviewableImage = isPreviewableImageFile(fileName);
  const isMake = isMakefile(fileName);
  const makeTargets = useMemo(
    () => (isMake && content ? parseMakeTargets(content) : []),
    [isMake, content],
  );
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Load file content
  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setContent(null);
    setImagePreview(null);
    setError(null);
    setSaveStatus("idle");

    const loadFile = isPreviewableImage
      ? invoke<ImagePreviewData>("read_image_preview", {
          path: filePath,
          projectPath,
        }).then((preview) => {
          if (cancelled) return;
          setImagePreview(preview);
          setLoading(false);
        })
      : invoke<string>("read_file_content", {
          path: filePath,
          projectPath,
        }).then((nextContent) => {
          if (cancelled) return;
          setContent(nextContent);
          setLoading(false);
        });

    loadFile.catch((err) => {
      if (cancelled) return;
      setError(String(err));
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [filePath, projectPath, isPreviewableImage]);

  // Cleanup timers
  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (savedResetRef.current) clearTimeout(savedResetRef.current);
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    setLanguageExtension([]);
    if (isPreviewableImage || (isMarkdown && previewMode)) return;
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
  }, [fileName, isMarkdown, isPreviewableImage, previewMode]);

  const handleChange = useCallback(
    (value: string) => {
      setContent(value);

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (savedResetRef.current) clearTimeout(savedResetRef.current);

      setSaveStatus("saving");
      saveTimerRef.current = setTimeout(async () => {
        try {
          await invoke("write_file_content", {
            path: filePath,
            content: value,
            projectPath,
          });
          setSaveStatus("saved");
          savedResetRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
        } catch {
          setSaveStatus("error");
        }
      }, 1500);
    },
    [filePath, projectPath],
  );

  const extensions = useMemo(
    () => [languageExtension, editorBaseTheme],
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

  const statusLabel = isPreviewableImage
    ? imagePreview
      ? `${imagePreview.mimeType} - ${t("file.readOnly", "Read-only")}`
      : t("file.imagePreview", "Image preview")
    : saveLabel;

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
              color: "var(--aegis-text-dim)",
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
              color: "var(--aegis-text-muted)",
            }}
          >
            <span style={{ fontSize: 12.5 }}>{error}</span>
          </div>
        )}
        {!loading &&
          !error &&
          (isPreviewableImage && imagePreview ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                padding: 16,
                background: "rgb(var(--aegis-overlay) / 0.03)",
              }}
            >
              <img
                src={imagePreview.dataUrl}
                alt={fileName}
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                  borderRadius: 8,
                }}
                draggable={false}
              />
            </div>
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
            color: "var(--aegis-text-muted)",
            fontFamily: "var(--aegis-body)",
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
                color: "var(--aegis-text-dim)",
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
                  fontFamily: "var(--aegis-mono, monospace)",
                  padding: "2px 8px",
                  borderRadius: 4,
                  border: "1px solid var(--aegis-border)",
                  background: "var(--aegis-surface)",
                  color: "var(--aegis-text-secondary)",
                  cursor: "pointer",
                  lineHeight: 1.4,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--aegis-accent)";
                  e.currentTarget.style.color = "var(--aegis-text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--aegis-surface)";
                  e.currentTarget.style.color = "var(--aegis-text-secondary)";
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
                  : "var(--aegis-text-muted)",
              fontFamily: "var(--aegis-body)",
            }}
          >
            {statusLabel}
          </span>
        )}
      </div>
    </div>
  );
}

// ── FileViewer ───────────────────────────────────────────────────────────────

export function FileViewer({
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
}: {
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
  /**
   * Called when the user clicks a target button on a parsed Makefile.
   * Receives the target name (e.g. "build", "test", "clean") — caller is
   * responsible for routing it to the right terminal session.
   */
  onRunMakeTarget?: (target: string) => void;
}) {
  const { t } = useTranslation();
  const [previewModes, setPreviewModes] = useState<Record<string, boolean>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [tabMenu, setTabMenu] = useState<{
    x: number;
    y: number;
    path: string;
  } | null>(null);
  const tabMenuRef = useRef<HTMLDivElement | null>(null);
  const [tabMenuPos, setTabMenuPos] = useState<{
    left: number;
    top: number;
  } | null>(null);

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
        if (prev[tab.path]) next[tab.path] = true;
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

  const activePreviewMode = !!previewModes[activeTab.path];
  const activeIsMarkdown = isMarkdownFile(activeTab.name);
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
                    ? "2px solid var(--aegis-primary)"
                    : "2px solid transparent",
                  background: isActive
                    ? "var(--aegis-elevated)"
                    : "transparent",
                  fontSize: 12.5,
                  fontWeight: isActive ? 500 : 400,
                  color: isActive
                    ? "var(--aegis-text)"
                    : "var(--aegis-text-secondary)",
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
                    color: "var(--aegis-text-dim)",
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
                  [activeTab.path]: !prev[activeTab.path],
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
                  ? "var(--aegis-primary)"
                  : "var(--aegis-text-dim)",
                fontSize: 11.5,
                fontFamily: "var(--aegis-body)",
                flexShrink: 0,
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "var(--aegis-hover)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "none")
              }
            >
              {activePreviewMode
                ? t("common.edit", "Edit")
                : t("common.preview", "Preview")}
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
                color: "var(--aegis-text-dim)",
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
                    color: "var(--aegis-menu-text)",
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
                previewMode={!!previewModes[tab.path]}
                onRunMakeTarget={onRunMakeTarget}
              />
            </div>
          );
        })}
      </div>

      {/* Right-click tab context menu */}
      {tabMenu && tabMenuIndex !== -1 && (
        <div
          ref={tabMenuRef}
          style={{
            position: "fixed",
            left: tabMenuPos?.left ?? tabMenu.x,
            top: tabMenuPos?.top ?? tabMenu.y,
            visibility: tabMenuPos ? "visible" : "hidden",
            zIndex: 300,
            background: "var(--aegis-menu-bg)",
            border: "1px solid var(--aegis-menu-border)",
            borderRadius: 8,
            boxShadow: "0 8px 32px rgba(0,0,0,0.32)",
            minWidth: 160,
            padding: "4px 0",
            fontSize: 12,
            color: "var(--aegis-menu-text)",
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
        </div>
      )}
    </div>
  );
}

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
        fontFamily: "var(--aegis-body)",
        color: disabled
          ? "var(--aegis-text-dim)"
          : "var(--aegis-menu-text)",
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
