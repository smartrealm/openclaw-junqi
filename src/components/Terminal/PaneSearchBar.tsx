// PaneSearchBar — kooky PaneSearchBar 1:1 port.
// In-terminal search overlay, @xterm/addon-search.
// Ctrl+F (Windows/Linux) / Cmd+F (macOS) to open; Esc to close.

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import { SearchAddon } from '@xterm/addon-search';
import { APP_PLATFORM } from './platform';

export interface PaneSearchBarProps {
  term: XTerm | null;
  isOpen: boolean;
  onClose: () => void;
}

const addonCache = new WeakMap<XTerm, SearchAddon>();
function getOrCreateAddon(term: XTerm): SearchAddon {
  if (addonCache.has(term)) return addonCache.get(term)!;
  const a = new SearchAddon(); term.loadAddon(a); addonCache.set(term, a); return a;
}

function readSearchColor(alpha?: number): string {
  if (typeof document === 'undefined') return 'transparent';
  const channels = getComputedStyle(document.documentElement)
    .getPropertyValue('--aegis-status-attention')
    .trim();
  if (!channels) return 'transparent';
  return alpha == null ? `rgb(${channels})` : `rgb(${channels} / ${alpha})`;
}

function getSearchDecorations() {
  const match = readSearchColor();
  return {
    matchBackground: readSearchColor(0.2),
    matchBorder: readSearchColor(0.55),
    matchOverviewRuler: match,
    activeMatchColorOverviewRuler: match,
    selectedMatchBackground: readSearchColor(0.4),
    selectedMatchBorder: match,
    selectedMatchOverviewRuler: match,
  };
}

export function PaneSearchBar({ term, isOpen, onClose }: PaneSearchBarProps) {
  const [needle, setNeedle] = useState('');
  const [cs, setCs] = useState(false);
  const [ww, setWw] = useState(false);
  const [rx, setRx] = useState(false);
  const [noResult, setNoResult] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isWin = APP_PLATFORM === 'windows';

  useEffect(() => {
    if (isOpen) { inputRef.current?.focus(); inputRef.current?.select(); }
    else { setNeedle(''); setNoResult(false); }
  }, [isOpen]);

  const doSearch = useCallback((val: string, dir: 'forward'|'backward' = 'forward') => {
    if (!term || !val) { setNoResult(false); return; }
    const a = getOrCreateAddon(term);
    const found = dir === 'forward'
      ? a.findNext(val, { caseSensitive: cs, wholeWord: ww, regex: rx, decorations: getSearchDecorations() })
      : a.findPrevious(val, { caseSensitive: cs, wholeWord: ww, regex: rx, decorations: getSearchDecorations() });
    setNoResult(!found);
  }, [term, cs, ww, rx]);

  useEffect(() => {
    if (isOpen && needle) doSearch(needle); else setNoResult(false);
  }, [needle, cs, ww, rx, isOpen, doSearch]);

  useEffect(() => {
    if (!isOpen && term) addonCache.get(term)?.clearDecorations();
  }, [isOpen, term]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Enter') { e.preventDefault(); doSearch(needle, e.shiftKey ? 'backward' : 'forward'); }
    e.stopPropagation();
  }, [needle, doSearch, onClose]);

  if (!isOpen) return null;

  const hint = isWin ? 'Ctrl+F' : 'Cmd+F';

  const toggle = (active: boolean, title: string, fn: () => void, lbl: string) => (
    <button title={title} onClick={fn} style={{
      height: 22, minWidth: 22, padding: '0 5px', borderRadius: 4, border: 'none',
      cursor: 'pointer', fontSize: 11, fontFamily: '"JetBrains Mono", monospace', flexShrink: 0,
      background: active ? 'rgb(var(--aegis-primary)/0.2)' : 'transparent',
      color: active ? 'rgb(var(--aegis-primary))' : 'rgb(var(--aegis-text-dim))',
      outline: active ? '1px solid rgb(var(--aegis-primary)/0.4)' : 'none', outlineOffset: -1,
    }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.06)'; }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >{lbl}</button>
  );

  const navBtn = (title: string, fn: () => void, d: string) => (
    <button title={title} onClick={fn} style={{
      height: 22, width: 22, padding: 0, borderRadius: 4, border: 'none',
      cursor: 'pointer', background: 'transparent',
      color: 'rgb(var(--aegis-text-dim))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.08)'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text))'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text-dim))'; }}
    >
      <svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'>
        <path d={d} />
      </svg>
    </button>
  );

  return (
    <div
      style={{
        position: 'absolute', top: 6, right: 8, zIndex: 60,
        display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px',
        background: 'rgb(var(--aegis-elevated))',
        border: '1px solid var(--aegis-border-hover)',
        borderRadius: 7, boxShadow: 'var(--aegis-shadow-popover)',
        minWidth: 260, maxWidth: 380,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='rgb(var(--aegis-text-dim))' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' style={{ flexShrink: 0 }}>
        <circle cx='11' cy='11' r='8' /><path d='m21 21-4.35-4.35' />
      </svg>
      <input
        ref={inputRef}
        value={needle}
        onChange={(e) => setNeedle(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={'Search (' + hint + ')'}
        style={{
          flex: 1, height: 22, background: 'transparent', border: 'none', outline: 'none',
          color: noResult ? 'rgb(var(--aegis-status-failed))' : 'rgb(var(--aegis-text))',
          fontSize: 12, fontFamily: '"JetBrains Mono", monospace', minWidth: 0,
        }}
      />
      {noResult && needle && (
        <span style={{ fontSize: 10, color: 'rgb(var(--aegis-status-failed))', flexShrink: 0, whiteSpace: 'nowrap' }}>No results</span>
      )}
      {toggle(cs, 'Match Case', () => setCs((v) => !v), 'Aa')}
      {toggle(ww, 'Whole Word', () => setWw((v) => !v), 'W')}
      {toggle(rx, 'Use Regex', () => setRx((v) => !v), '.*')}
      <div style={{ width: 1, height: 16, background: 'var(--aegis-border)', flexShrink: 0 }} />
      {navBtn('Previous (Shift+Enter)', () => doSearch(needle, 'backward'), 'M18 15l-6-6-6 6')}
      {navBtn('Next (Enter)', () => doSearch(needle, 'forward'), 'M6 9l6 6 6-6')}
      {navBtn('Close (Esc)', onClose, 'M18 6 6 18M6 6l12 12')}
    </div>
  );
}

export default PaneSearchBar;
