// ─────────────────────────────────────────────────────────────────
// IconRegistry — aegis-aligned icon mapping.
//
// Every page consumes icons through this registry instead of importing
// from lucide-react directly. Two guarantees:
//   1. Each semantic role has ONE canonical icon (no "is it Cpu or Bot?")
//   2. The strokeWidth / size / color stay uniform across the app
// ─────────────────────────────────────────────────────────────────

import {
  // ── Navigation / shells
  LayoutDashboard, MessageCircle, Kanban, DollarSign, Clock, Bot,
  Puzzle, Terminal, Brain, FolderOpen, CalendarDays,
  Settings2, Activity, Sparkles, History, GitBranch, Users,
  Wifi, WifiOff,
  // ── Status / lifecycle
  CheckCircle2, XCircle, AlertTriangle, AlertCircle, Loader2,
  Play, Square, RotateCcw, RefreshCw, Pause,
  // ── Code / tools / content
  Code2, FileJson, FileText, FileCode, FileSearch,
  Wrench, Zap, Layers, Cpu, Globe, Volume2, VolumeX,
  HardDrive, MemoryStick, Server, Network,
  // ── UI primitives
  Plus, X, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Copy, Trash2, Pencil, Search, Filter, SearchCode,
  Eye, EyeOff, Maximize2, Minimize2,
  Save, Download, Upload, ExternalLink, Sun, Moon,
  // ── Notifications / chrome
  Bell, BellOff, BellRing,
  PanelLeft, PanelRightOpen, PanelRightClose,
  LayoutGrid, SlidersHorizontal,
  // ── Status indicators (dot glyphs)
  CircleDot, Circle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Stroke width used everywhere — keeps icons visually consistent. */
export const ICON_STROKE = 1.75;

/** Default pixel sizes (matches aegis nav + cards). */
export const ICON_SIZE = {
  nav: 18,
  card: 24,
  toolbar: 16,
  inline: 14,
  micro: 11,
} as const;

export interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

// Each semantic alias is a *pre-rendered JSX element* — callers just use
// `Icon.section.gateway` directly. To customize (size / stroke / color)
// at the call site, use the `<I>` wrapper below.
function makeRendered(Icon: LucideIcon, size: number = 16) {
  return <Icon size={size} strokeWidth={ICON_STROKE} />;
}

// ── Semantic alias table (kooky/aegis-aligned) ────────────────────────────
// Each alias maps to ONE icon. Pages import by semantic name, not by icon.

export const Icon = {
  // ── Navigation
  nav: {
    dashboard:  makeRendered(LayoutDashboard),
    chat:       makeRendered(MessageCircle),
    workshop:   makeRendered(Kanban),
    kanban:     makeRendered(Kanban),
    costs:      makeRendered(DollarSign),
    cron:       makeRendered(Clock),
    agents:     makeRendered(Bot),
    memory:     makeRendered(Brain),
    skills:     makeRendered(Puzzle),
    terminal:   makeRendered(Terminal),
    agentRun:   makeRendered(Sparkles),
    files:      makeRendered(FolderOpen),
    calendar:   makeRendered(CalendarDays),
    settings:   makeRendered(Settings2),
    perf:       makeRendered(Activity),
    history:    makeRendered(History),
    git:        makeRendered(GitBranch),
    team:       makeRendered(Users),
    preview:    makeRendered(Eye),
    commands:   makeRendered(LayoutGrid),
    agentsPanel:makeRendered(LayoutGrid),
  },

  // ── Section / card headers (24px, can be themed)
  section: {
    gateway:    makeRendered(Wifi),
    theme:      makeRendered(Sparkles),
    language:   makeRendered(Globe),
    notifications: makeRendered(Bell),
    sound:      makeRendered(Volume2),
    storage:    makeRendered(HardDrive),
    about:      makeRendered(FileText),
    memory:     makeRendered(Brain),
    models:     makeRendered(Cpu),
    tools:      makeRendered(Wrench),
    logs:       makeRendered(FileText),
  },

  // ── Inline actions (16px, button row)
  action: {
    add:         makeRendered(Plus),
    remove:      makeRendered(Trash2),
    close:       makeRendered(X),
    copy:        makeRendered(Copy),
    edit:        makeRendered(Pencil),
    refresh:     makeRendered(RefreshCw),
    search:      makeRendered(Search),
    filter:      makeRendered(Filter),
    save:        makeRendered(Save),
    download:    makeRendered(Download),
    upload:      makeRendered(Upload),
    external:    makeRendered(ExternalLink),
    expand:      makeRendered(Maximize2),
    collapse:    makeRendered(Minimize2),
    back:        makeRendered(ChevronLeft),
    next:        makeRendered(ChevronRight),
    up:          makeRendered(ChevronUp),
    down:        makeRendered(ChevronDown),
    bell:        makeRendered(Bell),
    bellOff:     makeRendered(BellOff),
    bellRing:    makeRendered(BellRing),
    play:        makeRendered(Play),
    stop:        makeRendered(Square),
    pause:       makeRendered(Pause),
    retry:       makeRendered(RotateCcw),
    panelOpen:   makeRendered(PanelRightOpen),
    panelClose:  makeRendered(PanelRightClose),
  },

  // ── Chrome glyphs (top strip / window controls / sidebar toggles) ─────
  chrome: {
    panelLeft:  makeRendered(PanelLeft),
    grid:       makeRendered(LayoutGrid, 14),
    bell:       makeRendered(Bell, 14),
  },

  // ── Status glyphs (use aegis colors)
  status: {
    ok:        makeRendered(CheckCircle2),
    error:     makeRendered(XCircle),
    warning:   makeRendered(AlertTriangle),
    info:      makeRendered(AlertCircle),
    loading:   makeRendered(Loader2),
    running:   makeRendered(Play),
    stopped:   makeRendered(Square),
    paused:    makeRendered(Pause),
  },

  // ── Content / data glyphs
  content: {
    json:      makeRendered(FileJson),
    text:      makeRendered(FileText),
    code:      makeRendered(Code2),
    search:    makeRendered(FileSearch),
    layers:    makeRendered(Layers),
    bolt:      makeRendered(Zap),
  },

  // ── Tiny dot indicators
  dot: {
    filled: makeRendered(CircleDot, 6),
    ring:   makeRendered(Circle, 6),
  },
};

export type IconRegistry = typeof Icon;