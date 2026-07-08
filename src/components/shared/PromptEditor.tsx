// ── PromptEditor — nezha-style @ mention + image attachments + draft cache ──
//
// Self-contained textarea wrapper that:
//   1. Detects `@` keystrokes and opens a file picker
//   2. Replaces `@query` with `@filename ` at cursor position
//   3. Renders chip tokens (`@foo`) with a subtle background
//   4. Detects large paste (>2KB) → calls onLargePaste
//   5. Accepts image drag-and-drop → shows thumbnails, calls onAttachImages
//   6. Caches draft text in a module-level ref → restores on re-mount
//
// Source pattern: nezha/src/components/new-task/PromptEditor.tsx

import {
  useCallback, useEffect, useRef, useState,
  type KeyboardEvent, type ChangeEvent, type DragEvent,
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import { File, X, Image as ImageIcon } from 'lucide-react';

const LARGE_PASTE_THRESHOLD = 2000;

// ── Draft cache ──────────────────────────────────────────────────────────────
const draftCache = new Map<string, { text: string; images: ImageAttach[] }>();

// ── Image helpers ────────────────────────────────────────────────────────────

async function readImagesAsDataURLs(files: File[]): Promise<ImageAttach[]> {
  const results: ImageAttach[] = [];
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) continue; // skip >10MB
    try {
      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      results.push({ src, name: file.name });
    } catch { /* skip unreadable */ }
  }
  return results;
}

// ── Platform-aware shortcut formatting ───────────────────────────────────────

function formatShortcutHint(shortcut: string): string {
  const isMac = typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('mac');
  if (shortcut === 'enter') return isMac ? '⏎' : 'Enter';
  return isMac ? '⌘+⏎' : 'Ctrl+Enter';
}

async function fetchSendShortcut(): Promise<string> {
  try {
    const settings = await invoke<{ send_shortcut?: string }>('load_app_settings');
    return settings?.send_shortcut || 'mod_enter';
  } catch {
    return 'mod_enter';
  }
}

export interface ImageAttach {
  src: string;   // dataURL
  name: string;  // original filename
}

export interface PromptEditorProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  /** Optional submit hint, e.g. "Send (⌘+Enter)". */
  submitHint?: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  /** kooky-style: when true, the editor renders as an expanded multi-line
   *  composer overlay (⌘L). Enter submits, Shift+Enter inserts a newline. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Called when large paste is detected — caller decides what to do. */
  onLargePaste?: (text: string) => void;
  /** Image attachments managed by the parent. */
  images?: ImageAttach[];
  /** Called when user drops images onto the editor. */
  onAttachImages?: (images: ImageAttach[]) => void;
  /** Called to remove a single image. */
  onRemoveImage?: (index: number) => void;
  /** Draft key for persisting text + images across unmounts. */
  draftKey?: string;
}

interface FileEntry {
  name: string;
  path: string;
  /** Pre-rendered chip label, e.g. "@src/App.tsx" */
  chip?: string;
}

export function PromptEditor({
  value,
  onChange,
  onSubmit,
  submitHint,
  placeholder = 'Ask anything... type @ to mention a file',
  rows = 4,
  disabled = false,
  onLargePaste,
  images,
  onAttachImages,
  onRemoveImage,
  draftKey,
  expanded = false,
  onExpandedChange,
}: PromptEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftSnapshotRef = useRef({
    value,
    images: images ?? [],
    onChange,
    onAttachImages,
  });
  const [picker, setPicker] = useState<{
    open: boolean;
    query: string;
    cursorStart: number;
    items: FileEntry[];
    selectedIndex: number;
    loading: boolean;
  }>({
    open: false,
    query: '',
    cursorStart: 0,
    items: [],
    selectedIndex: 0,
    loading: false,
  });

  useEffect(() => {
    draftSnapshotRef.current = {
      value,
      images: images ?? [],
      onChange,
      onAttachImages,
    };
  }, [images, onAttachImages, onChange, value]);

  // ── Draft cache: restore on mount, save on unmount ───────────────────────
  useEffect(() => {
    if (!draftKey) return;
    const cached = draftCache.get(draftKey);
    if (cached) {
      const snapshot = draftSnapshotRef.current;
      if (cached.text && !snapshot.value) snapshot.onChange(cached.text);
      if (cached.images.length > 0 && snapshot.onAttachImages) snapshot.onAttachImages(cached.images);
    }
    return () => {
      const snapshot = draftSnapshotRef.current;
      // Save on unmount
      draftCache.set(draftKey, {
        text: snapshot.value,
        images: snapshot.images,
      });
    };
  }, [draftKey]);

  // ── ⌘L multi-line composer (kooky-style) ────────────────────────────────────
  // Listens for the global 'aegis:open-multi-line-composer' event dispatched
  // by useKeyboardShortcuts, then expands the editor inline.
  useEffect(() => {
    const handler = () => onExpandedChange?.(true);
    window.addEventListener('aegis:open-multi-line-composer', handler);
    return () => window.removeEventListener('aegis:open-multi-line-composer', handler);
  }, [onExpandedChange]);

  // ── Auto-detect send shortcut from app settings ───────────────────────────
  const [detectedHint, setDetectedHint] = useState<string | null>(null);
  const sendShortcutRef = useRef<string>('mod_enter');
  useEffect(() => {
    if (submitHint) return;
    let cancelled = false;
    fetchSendShortcut().then((shortcut) => {
      if (!cancelled) {
        sendShortcutRef.current = shortcut;
        setDetectedHint(formatShortcutHint(shortcut));
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [submitHint]);

  const hint = submitHint ?? detectedHint ?? '';
  const hasImages = images && images.length > 0;

  // ── @ mention detection ──────────────────────────────────────────────────
  const detectMention = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      setPicker((p) => ({ ...p, open: false }));
      return;
    }
    const cursor = el.selectionStart;
    const before = value.slice(0, cursor);
    // Look for an `@` with no whitespace since.
    const atIdx = before.lastIndexOf('@');
    if (atIdx < 0) {
      setPicker((p) => ({ ...p, open: false }));
      return;
    }
    const query = before.slice(atIdx + 1);
    if (/[\s\n]/.test(query)) {
      setPicker((p) => ({ ...p, open: false }));
      return;
    }
    // Open picker; items fetched lazily in a separate effect.
    setPicker({
      open: true,
      query,
      cursorStart: atIdx,
      items: [],
      selectedIndex: 0,
      loading: true,
    });
  }, [value]);

  // ── Fetch workspace files when picker opens ──────────────────────────────
  useEffect(() => {
    if (!picker.open) return;
    let cancelled = false;
    (async () => {
      try {
        const workspacePath = await invoke<string>('get_workspace_path');
        const paths = await invoke<string[]>('list_project_files', { projectPath: workspacePath });
        if (cancelled) return;
        const filtered = (paths ?? []).filter((p) => {
          const name = p.split('/').pop() ?? p;
          return (
            !picker.query ||
            name.toLowerCase().includes(picker.query.toLowerCase()) ||
            p.toLowerCase().includes(picker.query.toLowerCase())
          );
        }).slice(0, 8);
        setPicker((p) => ({
          ...p,
          items: filtered.map((path) => {
            const name = path.split('/').pop() ?? path;
            return { name, path, chip: `@${name}` };
          }),
          loading: false,
          selectedIndex: 0,
        }));
      } catch {
        if (!cancelled) {
          setPicker((p) => ({ ...p, loading: false, items: [] }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [picker.open, picker.query]);

  // ── Replace @query with @filename at cursor ──────────────────────────────
  const insertMention = useCallback((entry: FileEntry) => {
    const el = textareaRef.current;
    if (!el) return;
    const cursor = el.selectionStart;
    const before = value.slice(0, picker.cursorStart);
    const after = value.slice(cursor);
    const insertion = entry.chip ?? `@${entry.name}`;
    const next = `${before}${insertion} ${after}`;
    onChange(next);
    setPicker({
      open: false,
      query: '',
      cursorStart: 0,
      items: [],
      selectedIndex: 0,
      loading: false,
    });
    // Restore focus + place cursor after the inserted chip + trailing space.
    requestAnimationFrame(() => {
      el.focus();
      const pos = before.length + insertion.length + 1;
      el.setSelectionRange(pos, pos);
    });
  }, [value, picker.cursorStart, onChange]);

  // ── Keyboard handling ────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Picker navigation takes priority over default cursor movement.
    if (picker.open && picker.items.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPicker((p) => ({
          ...p,
          selectedIndex: (p.selectedIndex + 1) % p.items.length,
        }));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setPicker((p) => ({
          ...p,
          selectedIndex: (p.selectedIndex - 1 + p.items.length) % p.items.length,
        }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const item = picker.items[picker.selectedIndex];
        if (item) insertMention(item);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setPicker((p) => ({ ...p, open: false }));
        return;
      }
    }

    // Submit on Enter or Ctrl/Cmd+Enter based on app_settings::send_shortcut
    const sc = sendShortcutRef.current;
    const shouldSubmit = sc === 'enter'
      ? (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey)
      : (e.key === 'Enter' && (e.metaKey || e.ctrlKey));
    if (shouldSubmit && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  }, [picker, insertMention, onSubmit]);

  // ── Paste: detect large text and offer to convert ──────────────────────
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Check for pasted images first
    const items = e.clipboardData?.items;
    if (items && onAttachImages) {
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        readImagesAsDataURLs(imageFiles).then((attachments) => {
          onAttachImages([...(images ?? []), ...attachments]);
        });
        return;
      }
    }
    // Text paste
    const text = e.clipboardData.getData('text/plain');
    if (text && text.length > LARGE_PASTE_THRESHOLD && onLargePaste) {
      onLargePaste(text);
    }
  }, [onLargePaste, onAttachImages, images]);

  // ── Drag-and-drop image attachments ───────────────────────────────────
  const [dragOver, setDragOver] = useState(false);
  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && onAttachImages) setDragOver(true);
  }, [disabled, onAttachImages]);
  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);
  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (disabled || !onAttachImages) return;
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;
    readImagesAsDataURLs(files).then((attachments) => {
      onAttachImages([...(images ?? []), ...attachments]);
    });
  }, [disabled, onAttachImages, images]);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="relative flex flex-col gap-1" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {/* Image thumbnails */}
      {hasImages && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {images!.map((img, idx) => (
            <div key={idx} className="relative group w-16 h-16 rounded-lg overflow-hidden border shrink-0"
              style={{ borderColor: 'rgb(var(--aegis-border))' }}>
              <img src={img.src} alt={img.name} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="text-[9px] text-white truncate px-1 max-w-full">{img.name}</span>
              </div>
              {onRemoveImage && (
                <button type="button" onClick={() => onRemoveImage(idx)}
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center bg-black/50 text-white hover:bg-red-500/80 transition-colors">
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="relative"
        style={dragOver ? { outline: '2px dashed rgb(var(--aegis-primary) / 0.4)', borderRadius: 8 } : undefined}>
        {/* Underlay renders `@chip` tokens with a subtle background */}
        <div
          aria-hidden
          className="absolute inset-0 px-3 py-2 rounded-md text-[13px] font-sans whitespace-pre-wrap break-words pointer-events-none overflow-hidden"
          style={{
            color: 'transparent',
            // Match textarea font metrics so chip positions line up.
            lineHeight: '1.5',
          }}
        >
          {renderWithChips(value)}
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
            onChange(e.target.value);
            detectMention();
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={detectMention}
          onClick={detectMention}
          onPaste={handlePaste}
          placeholder={placeholder}
          rows={expanded ? Math.max(rows, 10) : rows}
          disabled={disabled}
          className="relative w-full px-3 py-2 rounded-md text-[13px] outline-none resize-y"
          style={{
            background: 'rgb(var(--aegis-input))',
            border: '1px solid rgb(var(--aegis-border))',
            color: 'rgb(var(--aegis-text))',
            lineHeight: '1.5',
            caretColor: 'rgb(var(--aegis-text))',
            minHeight: 80,
          }}
        />
        {hint && (
          <div className="absolute right-2 bottom-1 text-[9.5px] text-aegis-text-dim pointer-events-none">
            {hint}
          </div>
        )}
      </div>

      {/* Mention picker */}
      {picker.open && (
        <div
          className="absolute z-50 left-0 right-0 mt-1 rounded-lg overflow-hidden"
          style={{
            bottom: '100%',
            background: 'rgb(var(--aegis-card))',
            border: '1px solid rgb(var(--aegis-border))',
            boxShadow: '0 -8px 24px rgb(0 0 0 / 0.2)',
            maxHeight: 220,
          }}
        >
          <div
            className="flex items-center gap-2 px-2.5 py-1.5 text-[10.5px] uppercase tracking-wider"
            style={{
              borderBottom: '1px solid rgb(var(--aegis-border))',
              color: 'rgb(var(--aegis-text-dim))',
            }}
          >
            <span className="font-mono">@</span>
            <span className="flex-1 truncate font-sans normal-case">
              {picker.query || 'mention a file…'}
            </span>
            <button
              type="button"
              onClick={() => setPicker((p) => ({ ...p, open: false }))}
              className="p-0.5 rounded hover:bg-[rgb(var(--aegis-overlay)/0.06)]"
            >
              <X size={11} />
            </button>
          </div>
          <div className="max-h-[180px] overflow-y-auto py-0.5">
            {picker.loading ? (
              <div className="px-3 py-3 text-[11px] text-aegis-text-dim">
                Loading…
              </div>
            ) : picker.items.length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-aegis-text-dim">
                No matching files in workspace.
              </div>
            ) : (
              picker.items.map((item, i) => (
                <button
                  key={item.path}
                  type="button"
                  onMouseEnter={() =>
                    setPicker((p) => ({ ...p, selectedIndex: i }))
                  }
                  onClick={() => insertMention(item)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-start text-[12px] transition-colors"
                  style={{
                    background:
                      i === picker.selectedIndex
                        ? 'rgb(var(--aegis-overlay) / 0.12)'
                        : 'transparent',
                    color: 'rgb(var(--aegis-text))',
                  }}
                >
                  <File size={12} className="text-aegis-text-dim shrink-0" />
                  <span className="font-mono truncate">{item.chip}</span>
                  <span
                    className="ml-auto text-[10px] truncate max-w-[40%]"
                    style={{ color: 'rgb(var(--aegis-text-dim))' }}
                  >
                    {item.path}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Render the textarea value with `@chip` tokens highlighted as background
 * spans. Used as the underlay so visual chip positions line up with the
 * transparent text in the textarea above it.
 */
function renderWithChips(value: string): React.ReactNode {
  // Match `@name` where name is a single token (no whitespace). Stops at
  // end of input or any whitespace/separator.
  const parts: React.ReactNode[] = [];
  const re = /@([A-Za-z0-9_./-]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(value)) !== null) {
    if (match.index > lastIndex) {
      parts.push(value.slice(lastIndex, match.index));
    }
    parts.push(
      <span
        key={`chip-${key++}`}
        style={{
          background: 'rgb(var(--aegis-primary) / 0.18)',
          borderRadius: 3,
          padding: '0 4px',
          color: 'transparent',
          // Ensure chips have height so they align with the line.
        }}
      >
        @{match[1]}
      </span>,
    );
    lastIndex = re.lastIndex;
  }
  if (lastIndex < value.length) {
    parts.push(value.slice(lastIndex));
  }
  // Preserve the trailing newline so layout matches the textarea.
  return <>{parts}</>;
}
