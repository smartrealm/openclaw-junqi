// ─────────────────────────────────────────────────────────────────
// previewStore — manages the right-side preview panel in ChatView.
//
// When the user clicks an artifact or file attachment, the content
// is loaded into this store. PreviewPanel reads from it and renders
// HTML/Markdown/SVG/images inline. Closing resets to empty state.
// ─────────────────────────────────────────────────────────────────

import { create } from 'zustand';

export type PreviewType = 'html' | 'markdown' | 'svg' | 'image' | 'code' | 'pdf' | null;

interface PreviewState {
  content: string;
  type: PreviewType;
  title: string;
  sourcePath?: string;
  isOpen: boolean;
  sourceTab: boolean;

  /** Open a preview from artifact or file attachment. */
  open: (content: string, type: PreviewType, title: string, sourcePath?: string) => void;
  /** Close the panel. */
  close: () => void;
  /** Toggle panel visibility without losing content. */
  toggle: () => void;
  /** Switch to source tab. */
  showSource: () => void;
  showPreview: () => void;
}

function detectType(mimeOrExt: string): PreviewType {
  const v = mimeOrExt.toLowerCase();
  if (v === 'html' || v === 'text/html') return 'html';
  if (v === 'markdown' || v === 'md' || v === 'text/markdown') return 'markdown';
  if (v === 'svg' || v === 'image/svg+xml') return 'svg';
  if (v.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'].includes(v)) return 'image';
  if (v === 'pdf' || v === 'application/pdf') return 'pdf';
  return 'code';
}

export const usePreviewStore = create<PreviewState>()((set) => ({
  content: '',
  type: null,
  title: '',
  sourcePath: undefined,
  isOpen: false,
  sourceTab: false,

  open: (content, type, title, sourcePath) => set({
    content,
    type: detectType(type || ''),
    title: title || 'Preview',
    sourcePath,
    isOpen: true,
    sourceTab: false,
  }),

  close: () => set({ isOpen: false }),

  toggle: () => set((s) => ({ isOpen: !s.isOpen })),

  showSource: () => set({ sourceTab: true }),
  showPreview: () => set({ sourceTab: false }),
}));