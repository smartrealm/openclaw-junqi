import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const contextMenuSource = readFileSync(new URL("./ContextMenu.tsx", import.meta.url), "utf8");
const explorerSource = readFileSync(new URL("./FileExplorer.tsx", import.meta.url), "utf8");
const viewerSource = readFileSync(new URL("./FileViewer.tsx", import.meta.url), "utf8");
const viewerToolbarSource = readFileSync(new URL("./FileViewerToolbar.tsx", import.meta.url), "utf8");
const markdownPreviewSource = readFileSync(new URL("./MarkdownPreview.tsx", import.meta.url), "utf8");
const previewDocumentSource = readFileSync(new URL("./useFilePreviewDocument.ts", import.meta.url), "utf8");
const managerSource = readFileSync(new URL("../../pages/FileManager.tsx", import.meta.url), "utf8");
const workspacePanelSource = readFileSync(new URL("../Workspace/WorkspacePanel.tsx", import.meta.url), "utf8");
const editorThemeSource = readFileSync(new URL("../../utils/codeMirrorTheme.ts", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../../styles/index.css", import.meta.url), "utf8");
const tauriLibSource = readFileSync(new URL("../../../src-tauri/src/lib.rs", import.meta.url), "utf8");
const fsCommandSource = readFileSync(new URL("../../../src-tauri/src/commands/fs_neu.rs", import.meta.url), "utf8");

test("file tree context menu escapes workspace clipping and exposes complete actions", () => {
  assert.match(contextMenuSource, /createPortal\(/);
  assert.match(contextMenuSource, /document\.body/);
  assert.match(contextMenuSource, /onOpen: \(\) => void/);
  assert.match(contextMenuSource, /onRename: \(\) => void/);
  assert.match(explorerSource, /safeInvoke<string>\("rename_path"/);
  assert.match(explorerSource, /await onBeforePathMutation\?\.\(current\.path, current\.isDir\)/);
  assert.match(explorerSource, /startCreateAtRoot/);
});

test("file viewer defaults markdown to preview and supports explicit durable save", () => {
  assert.match(viewerSource, /previewModes\[activeTab\.path\] \?\? true/);
  assert.match(viewerSource, /<FileViewerToolbar/);
  assert.match(viewerToolbarSource, /aria-pressed=\{active\}/);
  assert.match(viewerToolbarSource, /onViewModeChange\("source"\)/);
  assert.match(viewerToolbarSource, /onViewModeChange\("preview"\)/);
  assert.match(markdownPreviewSource, /<ReactMarkdown[\s\S]*remarkPlugins=\{\[remarkGfm\]\}/);
  assert.match(viewerSource, /onOpenLocalLink=\{openLocalMarkdownLink\}/);
  assert.match(viewerSource, /resolveMarkdownResourcePath\(href, filePath, projectPath\)/);
  assert.doesNotMatch(viewerSource, /dangerouslySetInnerHTML/);
  assert.match(viewerSource, /event\.key\.toLowerCase\(\) === "s"/);
  assert.match(viewerSource, /handleSaveNow/);
  assert.match(viewerSource, /const flushPath = useCallback\(async \(path: string, isDirectory: boolean\)/);
  assert.match(viewerSource, /useImperativeHandle\(ref, \(\) => \(\{[\s\S]*flushPath/);
  assert.match(viewerSource, /closeTabsAfterSave/);
  assert.match(viewerSource, /createPortal\([\s\S]*tabMenu[\s\S]*document\.body/);
});

test("file viewer keeps editor and Markdown preview readable in every application theme", () => {
  assert.match(managerSource, /const resolvedTheme = useTheme\(\)/);
  assert.match(managerSource, /themeVariant=\{themeVariant\}/);
  assert.match(workspacePanelSource, /const resolvedTheme = useTheme\(\)/);
  assert.match(workspacePanelSource, /<FileViewer[\s\S]*themeVariant=\{themeVariant\}/);
  assert.match(viewerSource, /const extensions = useMemo\([\s\S]*languageExtension,[\s\S]*aegisCodeMirrorBaseTheme/);
  assert.match(editorThemeSource, /color: 'rgb\(var\(--aegis-text\)\)'/);
  assert.match(editorThemeSource, /color: 'rgb\(var\(--aegis-text-dim\)\)'/);
  assert.doesNotMatch(editorThemeSource, /color: 'var\(--aegis-text(?:-dim|-muted|-secondary)?\)'/);
  assert.match(stylesSource, /\.md-preview-scroll\s*\{[\s\S]*overflow: auto/);
  assert.match(stylesSource, /\.md-preview\s*\{[\s\S]*color: rgb\(var\(--aegis-text\)\)/);
  assert.match(stylesSource, /\.md-preview table[\s\S]*overflow-x: auto/);
});

test("guarded file writes stay registered across the TypeScript and Rust IPC boundary", () => {
  assert.match(previewDocumentSource, /invoke<boolean>\("write_file_content_if_unchanged", \{[\s\S]*expectedContent:/);
  // Unmounting must still flush unsaved content. The call goes through a ref so
  // the handler can depend on nothing and stay a true unmount handler.
  assert.match(
    previewDocumentSource,
    /useEffect\(\(\) => \(\) => \{[\s\S]*void persistLatestContent(?:Ref\.current)?\(\)/,
  );
  assert.doesNotMatch(previewDocumentSource, /useEffect\(\(\) => \(\) => \{[\s\S]*void invoke\("write_file_content_if_unchanged"/);
  assert.match(tauriLibSource, /commands::fs_neu::write_file_content_if_unchanged/);
  assert.match(fsCommandSource, /pub async fn write_file_content_if_unchanged\([\s\S]*expected_content: String/);
});

test("workspace previews share one typed IPC contract and never edit unknown binary files", () => {
  assert.match(previewDocumentSource, /invoke<unknown>\("read_file_preview"/);
  assert.match(workspacePanelSource, /<FileViewer/);
  assert.doesNotMatch(workspacePanelSource, /readFilePreview|writeFileText|FileReadOnlyPreview/);
  assert.match(viewerSource, /<FileReadOnlyPreview/);
  assert.match(tauriLibSource, /commands::fs_neu::read_file_preview/);
  assert.match(fsCommandSource, /enum FilePreviewKind \{[\s\S]*Text,[\s\S]*Image,[\s\S]*Pdf,[\s\S]*Binary/);
  assert.doesNotMatch(tauriLibSource, /commands::fs_neu::read_(?:file_content|image_preview)/);
});
