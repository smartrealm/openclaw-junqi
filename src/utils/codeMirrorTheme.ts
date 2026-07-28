import { EditorView } from '@uiw/react-codemirror';
import type { Extension } from '@codemirror/state';
import { githubDark, githubLight } from '@uiw/codemirror-theme-github';
import { solarizedLight } from '@uiw/codemirror-theme-solarized';

export type CodeMirrorThemeVariant =
  | 'dark'
  | 'midnight'
  | 'light'
  | 'eyecare'
  | 'aegis-dark'
  | 'aegis-midnight'
  | 'aegis-light'
  | 'aegis-eyecare';

export function getCodeMirrorColorTheme(theme: CodeMirrorThemeVariant): Extension {
  const variant = theme.replace('aegis-', '');
  if (variant === 'dark' || variant === 'midnight') return githubDark;
  if (variant === 'eyecare') return solarizedLight;
  return githubLight;
}

export const aegisCodeMirrorBaseTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'rgb(var(--aegis-text))',
    fontFamily: 'var(--font-editor, var(--font-mono))',
    fontSize: '13px',
    background: 'var(--aegis-elevated)',
  },
  '.cm-editor': {
    background: 'var(--aegis-elevated)',
  },
  '.cm-scroller': {
    overflow: 'auto',
    lineHeight: '1.6',
    background: 'var(--aegis-elevated)',
  },
  '.cm-content': {
    padding: '12px 0',
    caretColor: 'rgb(var(--aegis-text))',
    color: 'rgb(var(--aegis-text))',
  },
  '.cm-line': {
    color: 'rgb(var(--aegis-text))',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'rgb(var(--aegis-text))',
  },
  '.cm-gutters': {
    borderRight: '1px solid var(--aegis-border)',
    background: 'var(--aegis-surface)',
    color: 'rgb(var(--aegis-text-dim))',
    fontSize: '12px',
    minWidth: '44px',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 4px',
    color: 'rgb(var(--aegis-text-dim))',
  },
  '.cm-activeLineGutter, .cm-focused .cm-activeLine, .cm-activeLine': {
    background: 'rgb(var(--aegis-overlay) / 0.06)',
  },
});
