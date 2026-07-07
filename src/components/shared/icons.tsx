// ─────────────────────────────────────────────────────────────────
// IconRegistry — aegis-aligned icon mapping.
//
// Every page consumes icons through this registry instead of importing
// directly from icon libraries. Two guarantees:
//   1. Each semantic role has ONE canonical icon (no "is it Cpu or Bot?")
//   2. The strokeWeight / size / color stay uniform across the app
//
// Chrome/nav/section/action → lucide-react (stable, familiar)
// Agent/tool brand icons        → @phosphor-icons/react (polished, SF-Symbol-grade)
// ─────────────────────────────────────────────────────────────────

import React from 'react';
import {
  // ── Navigation / shells
  LayoutDashboard, MessageCircle, Kanban, DollarSign, Clock, Bot,
  Puzzle, Terminal, Brain, FolderOpen, CalendarDays,
  Settings2, Activity, Sparkles, History, GitBranch, Users,
  Wifi, WifiOff,
  // ── Status / lifecycle
  CheckCircle2, XCircle, AlertTriangle, AlertCircle, Loader2,
  Play, Square, RotateCcw, RefreshCw, Pause, Image as ImageIcon,
  // ── Code / tools / content
  Code2, FileJson, FileText, FileCode, FileCode2, FileSearch,
  FileSpreadsheet, FileArchive, Music, Film,
  Wrench, Zap, Layers, Cpu, Globe, Volume2, VolumeX,
  HardDrive, MemoryStick, Server, Network,
  // ── UI primitives
  Plus, X, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Copy, Trash2, Pencil, Search, Filter, SearchCode,
  Eye, EyeOff, Maximize2, Minimize2,
  Save, Download, Upload, ExternalLink, Sun, Moon,
  Send, Paperclip, Camera, Mic, Check,
  // ── Notifications / chrome
  Bell, BellOff, BellRing,
  PanelLeft, PanelRightOpen, PanelRightClose,
  LayoutGrid, SlidersHorizontal,
  // ── Status indicators (dot glyphs)
  CircleDot, Circle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ── Phosphor icons (agent brands + chat tool palette)
import {
  Sparkle,
  Robot,
  Pi,
  Diamond,
  CursorClick,
  Lightning,
  Hexagon,
  XLogo,
  X as XPh,
  Cloud,
  ArrowCircleUp,
  Moon as MoonPh,
  BracketsCurly,
  Wrench as WrenchPh,
  Brain as BrainPh,
  TerminalWindow,
  PencilSimple,
  MagnifyingGlass,
  Monitor as MonitorPh,
  Gear as GearPh,
  PaperPlaneRight,
  ChartBar as ChartBarPh,
  Clock as ClockPh,
  Image as ImagePh,
  SpeakerHigh,
  WifiHigh,
  ChatCircle,
  DeviceMobile,
  PuzzlePiece,
  BookOpen,
  Newspaper,
  FloppyDisk,
  CurrencyDollar,
  Broom,
  ArrowsClockwise,
  SoccerBall,
  Cube as CubePh,
  Lightbulb,
  Heart,
  Users as UsersPh,
  Target,
  Calendar as CalendarPh,
  Note as NotePh,
  ArrowDown,
  ArrowUp,
  Atom,
  Database,
  Fire,
  FlowArrow,
  Graph,
  Hexagon as HexagonPh,
  HouseLine,
  Key,
  RocketLaunch,
  Triangle,
  Waveform,
} from '@phosphor-icons/react';

/** Stroke width used everywhere — keeps lucide icons visually consistent. */
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

// ── Pre-render helpers ──────────────────────────────────────────────────────

/** Pre-render a lucide icon at a fixed size + stroke for the registry. */
function makeRendered(Icon: LucideIcon, size: number = 16) {
  return <Icon size={size} strokeWidth={ICON_STROKE} />;
}

/** Pre-render a phosphor icon at a fixed size for the registry. */
function phos(Icon: React.ComponentType<any>, size: number = 14) {
  return <Icon size={size} weight="regular" />;
}

// ── Semantic alias table (kooky/aegis-aligned) ────────────────────────────

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

  // ── Agent icons (kooky AgentTemplate.tintHex palette → phosphor regular)
  // Phosphor's "regular" weight matches kooky's SF Symbol aesthetic — clean,
  // geometric, consistent optical volume. Each icon is pre-rendered at 14px.
  agent: {
    claude:         { icon: phos(Sparkle, 14),         tint: 'D97757', label: 'Claude Code' },
    codex:          { icon: phos(Robot, 14),            tint: '7A9DFF', label: 'Codex' },
    pi:             { icon: phos(Pi, 14),               tint: 'C2C5CE', label: 'Pi' },
    gemini:         { icon: phos(Diamond, 14),          tint: '3186FF', label: 'Gemini CLI' },
    'cursor-agent': { icon: phos(CursorClick, 14),      tint: 'F54E00', label: 'Cursor CLI' },
    amp:            { icon: phos(Lightning, 14),         tint: 'E8B168', label: 'Amp' },
    copilot:        { icon: phos(Hexagon, 14),           tint: '6E40C9', label: 'Copilot CLI' },
    grok:           { icon: phos(XLogo, 14),             tint: 'E8E8E8', label: 'Grok Build' },
    'kiro-cli':     { icon: phos(Cloud, 14),             tint: '9046FF', label: 'Kiro CLI' },
    agy:            { icon: phos(ArrowCircleUp, 14),     tint: '4285F4', label: 'Antigravity CLI' },
    kimi:           { icon: phos(MoonPh, 14),            tint: 'C9C3D6', label: 'Kimi Code' },
    opencode:       { icon: phos(BracketsCurly, 14),     tint: 'B0B0B0', label: 'OpenCode' },
    aider:          { icon: phos(WrenchPh, 14),          tint: '44AA44', label: 'Aider' },
    qwen:           { icon: phos(BrainPh, 14),           tint: '6600CC', label: 'Qwen CLI' },
  } as Record<string, { icon: React.ReactNode; tint: string; label: string }>,

  // ── Model provider icons
  // Same optical system as agent/tool icons: Phosphor regular at small sizes,
  // with a compact tint token for provider chips and cards.
  provider: {
    anthropic:          { icon: phos(Sparkle, 14),       tint: 'D97757', label: 'Anthropic' },
    openai:             { icon: phos(Robot, 14),         tint: '10A37F', label: 'OpenAI' },
    google:             { icon: phos(Diamond, 14),       tint: '4285F4', label: 'Google Gemini' },
    xai:                { icon: phos(XLogo, 14),         tint: 'E8E8E8', label: 'xAI' },
    mistral:            { icon: phos(Triangle, 14),      tint: 'FF7000', label: 'Mistral AI' },
    openrouter:         { icon: phos(FlowArrow, 14),     tint: 'F65BA4', label: 'OpenRouter' },
    groq:               { icon: phos(Lightning, 14),     tint: 'F55036', label: 'Groq' },
    together:           { icon: phos(Graph, 14),         tint: '2D7DFF', label: 'Together AI' },
    kilocode:           { icon: phos(HexagonPh, 14),     tint: 'A855F7', label: 'KiloCode' },
    venice:             { icon: phos(Waveform, 14),      tint: '14B8A6', label: 'Venice AI' },
    huggingface:        { icon: phos(Heart, 14),         tint: 'FFCC4D', label: 'Hugging Face' },
    litellm:            { icon: phos(BracketsCurly, 14), tint: '64748B', label: 'LiteLLM' },
    'vercel-ai-gateway':{ icon: phos(Triangle, 14),      tint: 'E5E7EB', label: 'Vercel AI Gateway' },
    nvidia:             { icon: phos(HexagonPh, 14),     tint: '76B900', label: 'NVIDIA' },
    'github-copilot':   { icon: phos(Hexagon, 14),       tint: '6E40C9', label: 'GitHub Copilot' },
    minimax:            { icon: phos(Cloud, 14),         tint: '4F46E5', label: 'MiniMax' },
    moonshot:           { icon: phos(MoonPh, 14),        tint: 'C9C3D6', label: 'Moonshot' },
    zai:                { icon: phos(Atom, 14),          tint: '22C55E', label: 'Z.ai' },
    deepseek:           { icon: phos(MagnifyingGlass, 14), tint: '2563EB', label: 'DeepSeek' },
    siliconflow:        { icon: phos(Waveform, 14),      tint: '06B6D4', label: 'SiliconFlow' },
    qianfan:            { icon: phos(Database, 14),      tint: '2563EB', label: 'Baidu Qianfan' },
    modelstudio:        { icon: phos(BrainPh, 14),       tint: '6600CC', label: 'Model Studio' },
    qwen:               { icon: phos(BrainPh, 14),       tint: '6600CC', label: 'Qwen' },
    volcengine:         { icon: phos(Fire, 14),          tint: 'EF4444', label: 'Volcengine' },
    xiaomi:             { icon: phos(HouseLine, 14),     tint: 'F97316', label: 'Xiaomi' },
    'kimi-coding':      { icon: phos(MoonPh, 14),        tint: 'C9C3D6', label: 'Kimi Coding' },
    kimi:               { icon: phos(MoonPh, 14),        tint: 'C9C3D6', label: 'Kimi' },
    ollama:             { icon: phos(CubePh, 14),        tint: 'A3A3A3', label: 'Ollama' },
    vllm:               { icon: phos(RocketLaunch, 14),  tint: '8B5CF6', label: 'vLLM' },
    custom:             { icon: phos(GearPh, 14),        tint: '94A3B8', label: 'Custom' },
    other:              { icon: phos(Key, 14),           tint: '94A3B8', label: 'Provider' },
  } as Record<string, { icon: React.ReactNode; tint: string; label: string }>,

  // ── Chat session icons (kooky-style 1:1) ─────────────────────────
  // One unified namespace for every icon that appears in the chat/agent
  // interaction surface. Each role is pre-rendered at its contextual size
  // so callers never worry about strokeWidth/weight — just pick the role.
  chat: {
    // ── Input composer
    input: {
      send:     makeRendered(Send, 16),
      attach:   makeRendered(Paperclip, 16),
      camera:   makeRendered(Camera, 16),
      mic:      makeRendered(Mic, 16),
      sparkles: makeRendered(Sparkles, 16),
      screen:   makeRendered(Eye, 16),
      clear:    makeRendered(Trash2, 16),
      close:    makeRendered(X, 16),
      more:     makeRendered(ChevronDown, 14),
    },

    // ── Message bubble actions
    action: {
      copy:     makeRendered(Copy, 12),
      copied:   makeRendered(Check, 12),
      edit:     makeRendered(Pencil, 12),
      refresh:  makeRendered(RefreshCw, 12),
      retry:    makeRendered(RotateCcw, 12),
      delete:   makeRendered(Trash2, 12),
      expand:   makeRendered(Maximize2, 12),
      collapse: makeRendered(Minimize2, 12),
      more:     makeRendered(ChevronDown, 12),
    },

    // ── File attachments (extension / MIME)
    attachment: {
      image:    makeRendered(ImageIcon, 14),
      audio:    makeRendered(Music, 14),
      video:    makeRendered(Film, 14),
      pdf:      makeRendered(FileText, 14),
      document: makeRendered(FileText, 14),
      sheet:    makeRendered(FileSpreadsheet, 14),
      code:     makeRendered(FileCode, 14),
      config:   makeRendered(FileJson, 14),
      archive:  makeRendered(FileArchive, 14),
      generic:  makeRendered(FileText, 14),
    },

    // ── Artifact cards (HTML/React/SVG/Code/Mermaid/Markdown)
    artifact: {
      html:     makeRendered(Globe, 16),
      react:    makeRendered(Code2, 16),
      svg:      makeRendered(ImageIcon, 16),
      code:     makeRendered(Code2, 16),
      mermaid:  makeRendered(FileText, 16),
      markdown: makeRendered(FileText, 16),
      generic:  makeRendered(FileText, 16),
    },

    // ── Tool call categories (kooky ToolCallActivityStrip palette)
    tool: {
      bash:     phos(TerminalWindow, 12),
      edit:     phos(PencilSimple, 12),
      read:     phos(FileText, 12),
      search:   phos(MagnifyingGlass, 12),
      web:      phos(Globe, 12),
      browser:  phos(MonitorPh, 12),
      process:  phos(GearPh, 12),
      memory:   phos(BrainPh, 12),
      agent:    phos(Robot, 12),
      message:  phos(PaperPlaneRight, 12),
      stats:    phos(ChartBarPh, 12),
      schedule: phos(ClockPh, 12),
      media:    phos(ImagePh, 12),
      audio:    phos(SpeakerHigh, 12),
      gateway:  phos(WifiHigh, 12),
      chat:     phos(ChatCircle, 12),
      default:  phos(WrenchPh, 12),
    },

    // ── Tab indicators
    tab: {
      compact: makeRendered(Layers, 12),
      context: makeRendered(FileText, 12),
      memory:  makeRendered(Brain, 12),
      archive: makeRendered(History, 12),
      pin:     makeRendered(Save, 12),
    },

    // ── Inline state glyphs
    state: {
      running: makeRendered(Loader2, 12),
      done:    makeRendered(Check, 12),
      error:   makeRendered(X, 12),
      stalled: makeRendered(Circle, 12),
      warn:    makeRendered(AlertTriangle, 12),
    },
  },
};

export type IconRegistry = typeof Icon;
