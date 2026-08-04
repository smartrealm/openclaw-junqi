import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Shield, X, Zap, FilePlus, Bot, ChevronDown, ChevronLeft, ChevronRight, Check, Trash2, GripVertical, Sparkles, Pencil, Plus, GitFork } from 'lucide-react';
import { Icon } from '@/components/shared/icons';
import { IconButton } from '@/components/shared/button/Button';
import { useTranslation } from 'react-i18next';
import { showConfirm } from '@/components/shared/AlertDialog';
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { isWeakSessionTopic, useChatStore, Session } from '@/stores/chatStore';
import { useGatewayDataStore, type AgentInfo } from '@/stores/gatewayDataStore';
import { gateway } from '@/services/gateway';
import { themeHex, dataColor } from '@/utils/theme-colors';
import { getSessionDisplayLabel } from '@/utils/sessionLabel';
import { applySessionRename } from '@/utils/sessionRename';
import { deleteSessionEverywhere } from '@/utils/sessionDelete';
import { coalesceSessionsByKey, isAgentMainSession, resolveNewSessionAgentId } from '@/utils/sessionLifecycle';
import { createNativeSession } from '@/utils/sessionCreate';
import { useNotificationStore } from '@/stores/notificationStore';
import { getAgentDisplayName } from '@/utils/agentDisplayName';
import { getAgentDefaultPersona, setAgentDefaultPersona } from '@/utils/agentPersona';
import type { SkillPersona } from '@/types/skills';
import clsx from 'clsx';
import { applyPersonaToSessionDraft } from '@/utils/personaDraft';
import { resolveAgentStatusSnapshot } from './agentStatus';
import { gatewayThinkingLevelLabel } from '@/services/gateway/sessionThinkingProfile';
import { useOptionalCollaborationChat } from './CollaborationChatProvider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SessionActionsMenu } from './session-actions/SessionActionsMenu';
import { ActiveTabIndicator } from '@/components/shared/TabMotion';

// ═══════════════════════════════════════════════════════════
// ChatTabs — Browser-style tab bar
// Layout: [Main ●] [Session A ×] [Session B ×]   [↺] [+]
// ═══════════════════════════════════════════════════════════

/**
 * Renaming helper lives in src/utils/sessionRename.ts — shared with the
 * NavSidebar session list so both surfaces call the same gateway + store
 * path. See that file for the contract.
 */

// ── Helpers ──────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatSessionTimestamp(timestamp?: string): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const sameYear = now.getFullYear() === date.getFullYear();
  const sameDay = sameYear
    && now.getMonth() === date.getMonth()
    && now.getDate() === date.getDate();

  if (sameDay) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return date.toLocaleDateString([], sameYear
    ? { month: 'numeric', day: 'numeric' }
    : { year: 'numeric', month: 'numeric', day: 'numeric' });
}

function formatSessionPreview(text?: unknown, max = 48): string {
  if (text == null) return '';

  let source = '';
  if (typeof text === 'string') {
    source = text;
  } else if (Array.isArray(text)) {
    source = text
      .map((item) => (typeof item === 'string' ? item : ''))
      .filter(Boolean)
      .join(' ');
  } else if (typeof text === 'object') {
    const candidate = (text as { text?: unknown; content?: unknown }).text
      ?? (text as { text?: unknown; content?: unknown }).content;
    source = typeof candidate === 'string' ? candidate : '';
  } else {
    source = String(text);
  }

  if (!source) return '';

  const normalized = source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';

  // Remove common non-semantic boilerplate so tab labels read like topic titles.
  const cleaned = normalized
    .replace(/^\[file attached:\s*[^\]]+\]\s*/gi, '')
    .replace(/^file attached:\s*/gi, '')
    .replace(/^attachment:\s*/gi, '')
    .replace(/^system:\s*/gi, '')
    .replace(/^assistant:\s*/gi, '')
    .replace(/^user:\s*/gi, '')
    .trim();
  if (!cleaned) return '';

  const preview = cleaned.length > max
    ? `${cleaned.slice(0, max - 1).trim()}…`
    : cleaned;
  return preview;
}

function getSessionPreview(
  displayLabel: string,
  session: Session,
  cachedMessages?: Array<{ role: string; content: unknown }>,
): string {
  const normalizedLabel = displayLabel.trim();

  const cachedPreview = [...(cachedMessages ?? [])]
    .reverse()
    .filter((message) => message.role === 'user' || message.role === 'assistant' || message.role === 'system')
    .map((message) => formatSessionPreview(message.content))
    .find((preview) => preview && preview !== normalizedLabel);

  if (cachedPreview) return cachedPreview;

  const lastMessagePreview = formatSessionPreview(session.lastMessage);
  if (lastMessagePreview && lastMessagePreview !== normalizedLabel) {
    return lastMessagePreview;
  }

  return '';
}

/** Parse sessionKey: agentId, is main session (agent:X:main), is desktop session (agent:X:desktop-*) */
function parseSessionKey(key: string): { agentId: string; isMainSession: boolean; isDesktopSession: boolean } {
  if (!key.startsWith('agent:')) {
    return { agentId: 'main', isMainSession: false, isDesktopSession: false };
  }
  const parts = key.split(':');
  const agentId = parts[1] ?? 'main';
  const rest = parts.slice(2).join(':');
  const isMainSession = isAgentMainSession(key);
  const isDesktopSession = rest.startsWith('desktop-');
  return { agentId, isMainSession, isDesktopSession };
}

function resolveSessionAgentId(session: Session): string {
  const raw = session as Session & {
    agentId?: string;
    agent_id?: string;
    agent?: string | { id?: string };
    metadata?: { agentId?: string; agent_id?: string; agent?: string | { id?: string } };
  };
  const direct = raw.agentId || raw.agent_id;
  if (direct) return direct;
  if (typeof raw.agent === 'string' && raw.agent) return raw.agent;
  if (typeof raw.agent === 'object' && raw.agent?.id) return raw.agent.id;
  const meta = raw.metadata;
  if (meta?.agentId || meta?.agent_id) return meta.agentId || meta.agent_id || 'main';
  if (typeof meta?.agent === 'string' && meta.agent) return meta.agent;
  if (typeof meta?.agent === 'object' && meta.agent?.id) return meta.agent.id;
  return parseSessionKey(session.key).agentId;
}

function compactTabLabel(label: string, max = 36): string {
  return label.length > max ? `${label.slice(0, max - 1).trim()}…` : label;
}

/** Readable label for a session tab — prioritize topic over generic session ids or timestamps */
function sessionLabel(
  session: Session | undefined,
  key: string,
  agents: AgentInfo[],
  mainAgentName: string = 'Main Agent',
  cachedMessages?: Array<{ role: string; content: unknown }>,
): string {
  const { agentId } = parseSessionKey(key);
  const agent = agents.find((a) => a.id === agentId);
  const agentDisplayName = getAgentDisplayName(agent, agentId === 'main' ? mainAgentName : agentId);
  const cachedPreview = [...(cachedMessages ?? [])]
    .reverse()
    .filter((message) => message.role === 'user' || message.role === 'assistant' || message.role === 'system')
    .map((message) => formatSessionPreview(message.content, 42))
    .find((preview) => preview && !isWeakSessionTopic(preview));
  const merged = {
    ...(session ?? { key }),
    ...(cachedPreview ? { lastMessage: session?.lastMessage || cachedPreview } : {}),
  };
  const label = getSessionDisplayLabel(merged, {
    mainSessionLabel: agentDisplayName,
    genericSessionLabel: 'Session',
  });
  return compactTabLabel(label, 28);
}

// ═══════════════════════════════════════════════════════════
// Agent 状态提示：每个 Agent 规范会话标签上的悬停卡片。
// ═══════════════════════════════════════════════════════════

function AgentStatusTooltip({
  visible,
  tokenUsage,
  connected,
  agentName,
  session,
  agentRuntime,
  thinkingLevel,
  thinkingLevels,
  thinkingDefault,
}: {
  visible: boolean;
  tokenUsage: ReturnType<typeof resolveAgentStatusSnapshot>['tokenUsage'];
  connected: boolean;
  agentName: string;
  session: Session;
  agentRuntime: ReturnType<typeof resolveAgentStatusSnapshot>['agentRuntime'];
  thinkingLevel: string | null;
  thinkingLevels: ReturnType<typeof resolveAgentStatusSnapshot>['thinkingLevels'];
  thinkingDefault: string | null;
}) {
  const { t } = useTranslation();

  const effectiveThinkingLabel = gatewayThinkingLevelLabel(thinkingLevel, thinkingLevels);
  const inheritedThinkingLabel = thinkingLevels
    ?.find((option) => option.id === thinkingDefault)
    ?.label ?? null;
  const thinkingLabel = thinkingLevel === null
    ? inheritedThinkingLabel
      ? t('input.sessionRuntimeThinkingInherited', { level: inheritedThinkingLabel })
      : t('input.sessionRuntimeThinkingInherit')
    : effectiveThinkingLabel ?? t('input.sessionRuntimeThinkingInherit');

  const contextTokens = tokenUsage?.contextTokens || 0;
  const maxTokens = tokenUsage?.maxTokens || 0;
  const usagePct = maxTokens > 0 ? Math.round((contextTokens / maxTokens) * 100) : 0;
  const compactions = tokenUsage?.compactions || 0;

  const model = session.model || '';
  const modelShort = model ? model.split('/').pop()! : '—';

  const sessionStart = session.createdAt || session.updatedAt;
  const sessionAge = sessionStart ? formatDuration(Date.now() - new Date(sessionStart).getTime()) : '—';

  const compactAt = maxTokens > 0 ? Math.round(maxTokens * 0.8) : null;
  const compactPct = compactAt && compactAt > 0 ? Math.round((contextTokens / compactAt) * 100) : 0;

  const usageColor = usagePct > 70 ? themeHex('danger') : usagePct > 40 ? themeHex('warning') : themeHex('primary');

  return (
    <>
      {visible && (
        <div
          className="absolute start-0 top-0 mt-2 w-[300px] rounded-2xl border border-[rgb(var(--aegis-overlay)/0.1)] z-[9999] overflow-hidden"
          style={{ background: 'var(--aegis-bg-frosted)', backdropFilter: 'blur(40px)', boxShadow: '0 16px 48px rgb(var(--aegis-overlay) / 0.2)' }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 p-4 border-b border-[rgb(var(--aegis-overlay)/0.06)]">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-aegis-primary/20 to-aegis-primary/5 border border-aegis-primary/25 flex items-center justify-center text-lg font-bold text-aegis-primary">
              {agentName.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-aegis-primary">{agentName}</div>
              <div className="text-[9px] text-aegis-text-dim font-mono">{modelShort}</div>
            </div>
            <div className={clsx(
              'px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider border',
              connected
                ? 'bg-aegis-primary/10 text-aegis-primary border-aegis-primary/20'
                : 'bg-[rgb(var(--aegis-overlay)/0.04)] text-aegis-text-muted border-[rgb(var(--aegis-overlay)/0.08)]'
            )}>
              {connected ? t('chat.statusActive') : t('chat.statusOffline')}
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-2 p-3">
            <div className="bg-[rgb(var(--aegis-overlay)/0.02)] border border-[rgb(var(--aegis-overlay)/0.04)] rounded-xl p-2.5 text-center">
              <div className="text-base font-extrabold" style={{ color: 'rgb(var(--aegis-accent))' }}>{compactions}</div>
              <div className="text-[8px] text-aegis-text-dim uppercase tracking-wider mt-0.5">{t('chat.compactions')}</div>
            </div>
            <div className="bg-[rgb(var(--aegis-overlay)/0.02)] border border-[rgb(var(--aegis-overlay)/0.04)] rounded-xl p-2.5 text-center">
              <div className="text-base font-extrabold" style={{ color: dataColor(3) }}>{sessionAge}</div>
              <div className="text-[8px] text-aegis-text-dim uppercase tracking-wider mt-0.5">{t('chat.sessionAge')}</div>
            </div>
          </div>

          {/* Context Usage Bar */}
          <div className="px-4 pb-2">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-[10px] text-aegis-text-muted flex items-center gap-1">
                <Zap size={10} /> {t('chat.contextUsage')}
              </span>
              <span className="text-[10px] font-semibold font-mono" style={{ color: usageColor }}>
                {maxTokens > 0 ? `${formatTokens(contextTokens)} / ${formatTokens(maxTokens)}` : '—'}
              </span>
            </div>
            <div className="w-full h-[5px] rounded-full bg-[rgb(var(--aegis-overlay)/0.04)] overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${usagePct}%`, background: `linear-gradient(90deg, ${themeHex('primary')}, ${usageColor})` }}
              />
            </div>
          </div>

          {/* 会话状态信息行。 */}
          <div className="px-4 pb-3 space-y-0">
            <div className="flex items-center gap-2 py-1.5 border-t border-[rgb(var(--aegis-overlay)/0.03)]">
              <span className="text-xs flex items-center text-aegis-text-dim">{Icon.chat.tab.compact}</span>
              <span className="text-[10px] text-aegis-text-muted flex-1">{t('chat.compactsAt')}</span>
              <span className={clsx('text-[10px] font-bold font-mono', compactPct > 80 ? 'text-aegis-danger' : compactPct > 50 ? 'text-aegis-warning' : 'text-aegis-primary')}>
                {compactAt === null ? '—' : `~${formatTokens(compactAt)}`}
              </span>
            </div>
            <div className="flex items-center gap-2 py-1.5 border-t border-[rgb(var(--aegis-overlay)/0.03)]">
              <span className="text-xs flex items-center text-aegis-text-dim">{Icon.chat.state.running}</span>
              <span className="text-[10px] text-aegis-text-muted flex-1">{t('chat.heartbeat')}</span>
              <span className="text-[10px] font-bold font-mono text-aegis-primary">{t('chat.heartbeatInterval')}</span>
            </div>
            {agentRuntime && (
              <div className="flex items-center gap-2 py-1.5 border-t border-[rgb(var(--aegis-overlay)/0.03)]">
                <Bot size={12} className="text-aegis-text-dim" aria-hidden />
                <span className="text-[10px] text-aegis-text-muted flex-1">{t('chat.agentRuntime')}</span>
                <span className="max-w-[148px] truncate text-[10px] font-bold font-mono" style={{ color: dataColor(3) }} title={agentRuntime.id}>
                  {agentRuntime.id}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 py-1.5 border-t border-[rgb(var(--aegis-overlay)/0.03)]">
              <span className="text-xs flex items-center text-aegis-text-dim">{Icon.chat.tab.memory}</span>
              <span className="text-[10px] text-aegis-text-muted flex-1">{t('chat.thinking')}</span>
              <span className="text-[10px] font-bold font-mono" style={{ color: dataColor(3) }}>{thinkingLabel}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// New Session Picker — dropdown from + button
// Supports choosing an agent to open its main or new desktop session, and opening an existing session.
// ═══════════════════════════════════════════════════════════

function NewSessionPicker({
  open,
  onClose,
  onOpenExisting,
  onOpenMainSession,
  onCreateNativeSession,
  creatingSession,
  loadingNew,
  newSessions,
  setNewSessions,
  messagesPerSession,
  agents,
  activeSessionKey,
  initialPersona,
  defaultPersonaFor,
  onClearPersona,
  onClearDefaultPersona,
}: {
  open: boolean;
  onClose: () => void;
  onOpenExisting: (key: string) => void;
  onOpenMainSession: (agentId: string, persona?: SkillPersona | null) => void;
  onCreateNativeSession: (agentId: string, persona?: SkillPersona | null) => Promise<boolean>;
  creatingSession: boolean;
  openTabs: string[];
  loadingNew: boolean;
  newSessions: Session[];
  /** Used by inline-rename to refresh the list after a successful save so
   *  the renamed row updates in place. */
  setNewSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  messagesPerSession: Record<string, Array<{ role: string; content: string }>>;
  agents: AgentInfo[];
  /** The session the user is looking at; seeds which agent a new session starts on. */
  activeSessionKey: string;
  /** Persona carried in from a SkillsPage skill click. Wins over agent default. */
  initialPersona?: SkillPersona | null;
  /** Resolves the default persona for a given agent (read from localStorage). */
  defaultPersonaFor?: (agentId: string) => SkillPersona | null;
  /** Called when user clears a skill-carried persona via the chip × button. */
  onClearPersona?: () => void;
  /** Called when user clears an agent-default persona via the chip × button. */
  onClearDefaultPersona?: (agentId: string) => void;
}) {
  const { t } = useTranslation();

  const hasMain = agents.some((a) => a.id === 'main');
  const mainDisplayName = getAgentDisplayName(
    agents.find((a) => a.id === 'main'),
    t('agents.mainAgent'),
  );
  const agentList: AgentInfo[] =
    agents.length === 0
      ? [{ id: 'main', name: t('agents.mainAgent') }]
      : hasMain
        ? agents
        : [{ id: 'main', name: mainDisplayName }, ...agents];
  // Seeded from the session in view rather than from list order: `agents` is a
  // gateway-ordered list, so `agentList[0]` picked an arbitrary agent whenever
  // the list had already loaded, and stayed stuck on the mount-time value
  // because nothing re-synced it once the list arrived.
  const seedAgentId = resolveNewSessionAgentId(activeSessionKey, agentList.map((a) => a.id));
  const [selectedAgentId, setSelectedAgentId] = useState(seedAgentId);
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    // Re-seed on each open so a picker mounted before `agents.list` returned,
    // or opened from a different session, still starts on the right agent.
    if (open && !wasOpenRef.current) setSelectedAgentId(seedAgentId);
    wasOpenRef.current = open;
  }, [open, seedAgentId]);
  const agentDropdownRef = useRef<HTMLDivElement>(null);
  // User explicitly cleared the chip; resets when the picker is reopened or
  // when the agent changes, so a fresh default / new persona can re-appear.
  const [personaCleared, setPersonaCleared] = useState(false);

  useEffect(() => {
    if (open) setPersonaCleared(false);
  }, [open]);

  // Per-item context menu (Open / Rename / Delete) + inline-rename state for
  // sessions that haven't been opened as tabs yet. Inline rename keeps the
  // edit flow in-place rather than opening a hidden tab just to rename.
  const [pickerCtxMenu, setPickerCtxMenu] = useState<{ session: Session; x: number; y: number } | null>(null);
  const pickerCtxRef = useRef<HTMLDivElement>(null);
  const [pickerRenamingKey, setPickerRenamingKey] = useState<string | null>(null);
  const [pickerRenameValue, setPickerRenameValue] = useState('');
  const [pickerRenaming, setPickerRenaming] = useState(false);
  const [pickerRenameError, setPickerRenameError] = useState<string | null>(null);

  useEffect(() => {
    if (!pickerCtxMenu) return;
    const onDown = (e: MouseEvent) => {
      if (pickerCtxRef.current && !pickerCtxRef.current.contains(e.target as Node)) {
        setPickerCtxMenu(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerCtxMenu]);

  const cancelPickerRename = useCallback(() => {
    setPickerRenamingKey(null);
    setPickerRenameValue('');
    setPickerRenameError(null);
  }, []);

  const beginPickerRename = useCallback((session: Session) => {
    setPickerCtxMenu(null);
    setPickerRenamingKey(session.key);
    setPickerRenameError(null);
    // Pre-fill with the same display label the row shows so the user sees
    // exactly what they'll replace.
    const display = sessionLabel(session, session.key, agents, mainDisplayName, messagesPerSession[session.key]);
    setPickerRenameValue(display || session.label || '');
  }, [agents, mainDisplayName, messagesPerSession]);

  const submitPickerRename = useCallback(async () => {
    if (pickerRenaming || !pickerRenamingKey) return;
    setPickerRenaming(true);
    try {
      const result = await applySessionRename(pickerRenamingKey, pickerRenameValue);
      if (!result.ok) {
        setPickerRenameError(result.error);
        return;
      }
      setNewSessions((previous) => previous.map((session) => (
        session.key === pickerRenamingKey ? { ...session, label: result.label } : session
      )));
      cancelPickerRename();
    } finally {
      setPickerRenaming(false);
    }
  }, [pickerRenaming, pickerRenamingKey, pickerRenameValue, cancelPickerRename, setNewSessions]);

  const deleteAvailableSession = useCallback((session: Session) => {
    if (parseSessionKey(session.key).isMainSession) return;
    setPickerCtxMenu(null);
    showConfirm(
      t('chat.deleteSession'),
      t('chat.deleteSessionConfirm'),
      async () => {
        const deleted = await deleteSessionEverywhere(session.key);
        if (deleted) onClose();
      }
    );
  }, [t, onClose]);

  const selectedAgent = agentList.find((a) => a.id === selectedAgentId) ?? agentList[0];

  // Skill-carried persona wins; otherwise fall back to the selected agent's default.
  // memoized so the localStorage read doesn't repeat on every render — the
  // picker re-renders frequently when typing in the rename input, and the
  // default lookup is a JSON.parse on the persisted map.
  const { effectivePersona, personaSource } = useMemo(() => {
    const def = defaultPersonaFor ? defaultPersonaFor(selectedAgentId) : null;
    const eff = personaCleared ? null : (initialPersona ?? def);
    const src: 'skill' | 'default' | null = personaCleared
      ? null
      : initialPersona
        ? 'skill'
        : def
          ? 'default'
          : null;
    return { effectivePersona: eff, personaSource: src };
    // defaultPersonaFor is provided by the parent (closure-captures
    // getAgentDefaultPersona — referentially stable).
  }, [selectedAgentId, initialPersona, personaCleared, defaultPersonaFor]);

  useEffect(() => {
    if (!agentDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (agentDropdownRef.current && !agentDropdownRef.current.contains(e.target as Node)) {
        setAgentDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [agentDropdownOpen]);

  return (
    <>
      {open && (
        <div
          className="absolute top-full end-0 mt-1.5 w-72 max-w-[min(24rem,calc(100vw-1rem))] max-h-[min(24rem,70vh)] overflow-y-auto rounded-xl overflow-hidden z-[100] bg-aegis-menu-bg border border-aegis-menu-border"
          style={{ boxShadow: 'var(--aegis-menu-shadow)' }}
        >
          <div className="p-2 min-w-0">
            {/* Agent picker — custom dropdown matching TitleBar style */}
            <div className="text-[9px] text-aegis-text-dim uppercase tracking-wider px-2 py-1 mb-1">
              {t('chat.newConversationWith')}
            </div>
            <div ref={agentDropdownRef} className="relative mb-2">
              <button
                onClick={() => setAgentDropdownOpen((v) => !v)}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium transition-all duration-150',
                  'text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.06)]',
                  'border border-[rgb(var(--aegis-overlay)/0.08)]',
                  agentDropdownOpen && 'bg-[rgb(var(--aegis-overlay)/0.06)] border-aegis-primary/20',
                )}
              >
                <Bot size={13} className="text-aegis-text-dim shrink-0" />
                <span className="flex-1 text-start truncate">
                  {getAgentDisplayName(
                    selectedAgent,
                    selectedAgent?.id === 'main' ? mainDisplayName : (selectedAgent?.id ?? 'Agent'),
                  )}
                </span>
                <ChevronDown size={11} className={clsx('text-aegis-text-dim shrink-0 transition-transform duration-150', agentDropdownOpen && 'rotate-180')} />
              </button>

              {agentDropdownOpen && (
                <div
                  className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl overflow-hidden bg-aegis-menu-bg border border-aegis-menu-border py-1"
                  style={{ boxShadow: 'var(--aegis-menu-shadow)' }}
                >
                  {agentList.map((a) => {
                    const isActive = a.id === selectedAgentId;
                    return (
                      <button
                        key={a.id}
                        onClick={() => { setSelectedAgentId(a.id); setAgentDropdownOpen(false); setPersonaCleared(false); }}
                        className={clsx(
                          'w-full flex items-center justify-between px-3 py-1.5 text-[12px] text-start transition-colors',
                          isActive
                            ? 'text-aegis-primary bg-[rgb(var(--aegis-primary)/0.08)]'
                            : 'text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.06)]',
                        )}
                      >
                        <span className="truncate">
                          {getAgentDisplayName(a, a.id === 'main' ? mainDisplayName : a.id)}
                        </span>
                        {isActive && <Check size={11} className="text-aegis-primary shrink-0 ms-2" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Persona chip — shown when a persona is preselected (from a skill click or agent default) */}
            {effectivePersona && (
              <div className="mx-2 mb-2 flex items-center gap-1.5 px-2 py-1.5 rounded-lg
                bg-aegis-primary/[0.06] border border-aegis-primary/15">
                <Sparkles size={11} className="text-aegis-primary shrink-0" />
                <span
                  className="flex-1 min-w-0 truncate text-[11px] text-aegis-text-secondary"
                  title={effectivePersona.label ? `${effectivePersona.label}\n\n${effectivePersona.prompt}` : effectivePersona.prompt}
                >
                  {t('chat.personaChip', { name: effectivePersona.label || effectivePersona.prompt.slice(0, 32) })}
                </span>
                <button
                  onClick={() => {
                    setPersonaCleared(true);
                    if (personaSource === 'skill') onClearPersona?.();
                    else if (personaSource === 'default') onClearDefaultPersona?.(selectedAgentId);
                  }}
                  title={t('chat.clearPersona')}
                  aria-label={t('chat.clearPersona')}
                  className="w-5 h-5 rounded-md flex items-center justify-center text-aegis-text-dim
                    hover:text-aegis-danger hover:bg-aegis-danger/[0.06] transition-colors shrink-0"
                >
                  <X size={11} />
                </button>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-col gap-1 mb-2">
              <button
                onClick={() => { onOpenMainSession(selectedAgentId, effectivePersona); onClose(); }}
                className={clsx(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-start transition-colors',
                  'hover:bg-[rgb(var(--aegis-overlay)/0.06)] border border-transparent hover:border-[rgb(var(--aegis-overlay)/0.08)]',
                )}
              >
                <Shield size={13} className="text-aegis-primary shrink-0" />
                <span className="text-[12px] text-aegis-text-secondary font-medium">
                  {t('chat.openMainSession')}
                </span>
              </button>
              <button
                type="button"
                disabled={creatingSession}
                onClick={() => {
                  void onCreateNativeSession(selectedAgentId, effectivePersona).then((created) => {
                    if (created) onClose();
                  });
                }}
                className={clsx(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-start transition-colors',
                  'hover:bg-[rgb(var(--aegis-overlay)/0.06)] border border-transparent hover:border-[rgb(var(--aegis-overlay)/0.08)]',
                  creatingSession && 'cursor-wait opacity-60',
                )}
              >
                <FilePlus size={13} className="text-aegis-primary shrink-0" />
                <span className="text-[12px] text-aegis-text-secondary font-medium">
                  {t('chat.newDesktopSession')}
                </span>
              </button>
            </div>

            {/* Existing sessions not yet open */}
            {(loadingNew || newSessions.length > 0) && (
              <div className="mx-1 my-1 border-t border-[rgb(var(--aegis-overlay)/0.06)]" />
            )}
            {/* Filter available sessions by selected agent */}
            {(() => {
              const agentSessions = newSessions.filter((s) => resolveSessionAgentId(s) === selectedAgentId);
              return (
                <>
            {agentSessions.length > 0 && (
              <div className="text-[9px] text-aegis-text-dim uppercase tracking-wider px-2 py-1 mb-0.5">
                {t('chat.availableSessions')}
                <span className="ml-1 opacity-50">({agentSessions.length})</span>
              </div>
            )}
            {loadingNew ? (
              <div className="text-center py-2 text-[11px] text-aegis-text-dim">
                {t('common.loading')}
              </div>
            ) : (
              agentSessions.map((session) => {
                const displayLabel = sessionLabel(
                  session,
                  session.key,
                  agents,
                  mainDisplayName,
                  messagesPerSession[session.key],
                );
                const fullLabel = session.topic
                  || (session.lastMessage && !isWeakSessionTopic(session.lastMessage) ? session.lastMessage : '')
                  || session.label
                  || session.key;
                const detailText = getSessionPreview(displayLabel, session, messagesPerSession[session.key]);
                const timeLabel = formatSessionTimestamp(session.lastTimestamp);
                const isRenaming = pickerRenamingKey === session.key;
                return (
                  <div
                    key={session.key}
                    className="group/picker-session relative w-full min-w-0 overflow-hidden flex flex-col gap-1 px-3 py-2 pr-14 rounded-lg text-start hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors cursor-pointer"
                    onClick={() => {
                      if (isRenaming) return;
                      onOpenExisting(session.key);
                      onClose();
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (isRenaming) return;
                      setPickerCtxMenu({ session, x: e.clientX, y: e.clientY });
                    }}
                    title={fullLabel}
                  >
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={pickerRenameValue}
                        onChange={(e) => setPickerRenameValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={cancelPickerRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void submitPickerRename();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            cancelPickerRename();
                          }
                        }}
                        disabled={pickerRenaming}
                        aria-invalid={pickerRenameError ? true : undefined}
                        title={pickerRenameError ?? undefined}
                        className={clsx(
                          'w-full max-w-full h-[22px] px-1.5 rounded bg-aegis-bg border text-[12px] text-aegis-text outline-none',
                          pickerRenameError ? 'border-aegis-danger/60' : 'border-aegis-primary/40',
                        )}
                      />
                    ) : (
                      <span className="block w-full min-w-0 truncate text-[12px] text-aegis-text font-medium">
                        {displayLabel}
                      </span>
                    )}
                    {(detailText || timeLabel) && !isRenaming && (
                      <span className="flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden text-[10px] text-aegis-text-dim">
                        {detailText && (
                          <span className="block flex-1 basis-0 min-w-0 truncate overflow-hidden">
                            {detailText}
                          </span>
                        )}
                        {timeLabel && (
                          <span className="shrink-0 text-[9px] text-aegis-text-dim/80 tabular-nums">
                            {timeLabel}
                          </span>
                        )}
                      </span>
                    )}
                    {!isRenaming && (
                      <span className="absolute right-2 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/picker-session:opacity-100 group-focus-within/picker-session:opacity-100">
                        <IconButton
                          size="xs"
                          aria-label={t('chat.renameSession')}
                          title={t('chat.renameSession')}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => { event.stopPropagation(); beginPickerRename(session); }}
                        >
                          <Pencil size={12} />
                        </IconButton>
                        {!parseSessionKey(session.key).isMainSession && (
                          <IconButton
                            size="xs"
                            tone="danger"
                            aria-label={t('chat.deleteSession')}
                            title={t('chat.deleteSession')}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => { event.stopPropagation(); deleteAvailableSession(session); }}
                          >
                            <Trash2 size={12} />
                          </IconButton>
                        )}
                      </span>
                    )}
                  </div>
                );
              })
            )}
              </>
            );
            })()}
          </div>
        </div>
      )}

      {/* Available-session context menu — portal'd so it's not clipped by the
          picker's overflow. Same three actions as the tab right-click menu,
          since available sessions ARE existing sessions (just not yet in a
          tab). Open opens them as a tab; Rename / Delete work directly. */}
      {pickerCtxMenu && createPortal(
        <div
          ref={pickerCtxRef}
          className="fixed z-[9999] min-w-[160px] py-1 rounded-lg border bg-aegis-menu-bg border-aegis-menu-border text-[12px]"
          style={{ left: pickerCtxMenu.x, top: pickerCtxMenu.y, boxShadow: 'var(--aegis-menu-shadow)' }}
        >
          <button
            onClick={() => { onOpenExisting(pickerCtxMenu.session.key); setPickerCtxMenu(null); onClose(); }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors"
          >
            <Shield size={13} className="opacity-60" />
            {t('chat.openSession')}
          </button>
          <button
            onClick={() => beginPickerRename(pickerCtxMenu.session)}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors"
          >
            <Pencil size={13} className="opacity-60" />
            {t('chat.renameSession')}
          </button>
          {!parseSessionKey(pickerCtxMenu.session.key).isMainSession && (
            <>
              <div className="my-1 border-t border-[rgb(var(--aegis-overlay)/0.06)]" />
              <button
                onClick={() => deleteAvailableSession(pickerCtxMenu.session)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 size={13} />
                {t('chat.deleteSession')}
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// ChatTabs — Main export
// ═══════════════════════════════════════════════════════════
// ── SortableTab ── a single tab wrapped for @dnd-kit drag-to-reorder ──────

function SortableTab({ id, children, disabled }: { id: string; children: React.ReactNode; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
    position: 'relative',
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} className="group shrink-0">
      {/* Drag handle: a thin grip icon on the left side of each tab */}
      {!disabled && (
        <button
          type="button"
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-[14px] h-full flex items-center justify-center opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
          {...listeners}
        >
          <GripVertical size={10} />
        </button>
      )}
      {children}
    </div>
  );
}


export function ChatTabs() {
  const { t } = useTranslation();
  const collaboration = useOptionalCollaborationChat();
  const {
    openTabs,
    activeSessionKey,
    sessions,
    messagesPerSession,
    openTab,
    closeTab,
    reorderTabs,
    setActiveSession,
    connected,
    connecting,
    tokenUsage,
    currentThinking,
    sessionDefaults,
  } = useChatStore();

  // ── Drag-to-reorder sensors ──
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldOrder = openTabs;
    const oldIdx = oldOrder.indexOf(String(active.id));
    const newIdx = oldOrder.indexOf(String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = [...oldOrder];
    reordered.splice(oldIdx, 1);
    reordered.splice(newIdx, 0, oldOrder[oldIdx]);
    reorderTabs(reordered);
  }, [openTabs, reorderTabs]);

  const activeTabIndex = openTabs.indexOf(activeSessionKey);
  const hasMultipleTabs = openTabs.length > 1;
  const canSwitchPrev = activeTabIndex > 0;
  const canSwitchNext = activeTabIndex >= 0 && activeTabIndex < openTabs.length - 1;
  const switchRelativeTab = useCallback((direction: -1 | 1) => {
    const index = openTabs.indexOf(useChatStore.getState().activeSessionKey);
    const nextKey = openTabs[index + direction];
    if (!nextKey) return;
    setActiveSession(nextKey);
  }, [openTabs, setActiveSession]);

  // ── New session picker (+ button) ──
  const [showNewPicker, setShowNewPicker] = useState(false);
  const [newSessions, setNewSessions] = useState<Session[]>([]);
  const [loadingNew, setLoadingNew] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const newPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showNewPicker) return;
    const handler = (e: MouseEvent) => {
      if (newPickerRef.current && !newPickerRef.current.contains(e.target as Node)) {
        setShowNewPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showNewPicker]);

  const handleOpenNewPicker = useCallback(() => {
    setShowNewPicker((v) => !v);
    if (!showNewPicker) {
      setLoadingNew(true);
      gateway.getSessions()
        .then((result: any) => {
          const existingByKey = new Map(sessions.map((session) => [session.key, session]));
          const list: Session[] = coalesceSessionsByKey((result?.sessions || []).map((s: any) => {
            const key = s.key || s.sessionKey;
            const previous = existingByKey.get(key);
            const lastMessage = s.lastMessage?.content?.substring?.(0, 80) || previous?.lastMessage;
            return {
              key,
              sessionId: typeof s.sessionId === 'string' ? s.sessionId : previous?.sessionId,
              label: typeof s.label === 'string'
                ? s.label
                : (typeof s.name === 'string' ? s.name : ''),
              topic: previous?.topic,
              lastMessage,
              lastTimestamp: s.lastMessage?.timestamp || s.updatedAt || previous?.lastTimestamp,
              kind: s.kind || previous?.kind,
              agentId: s.agentId || s.agent_id,
              agent: s.agent,
              metadata: s.metadata,
            };
          }));
          setNewSessions(list.filter((s) => !openTabs.includes(s.key)));
        })
        .catch(() => {})
        .finally(() => setLoadingNew(false));
    }
  }, [showNewPicker, openTabs, sessions]);

  // Persona carried in from a SkillsPage click. Cleared after the picker closes.
  const [pendingPersona, setPendingPersona] = useState<SkillPersona | null>(null);
  // Mirror of showNewPicker for the listener — reads via ref avoid stale-
  // closure traps where the listener re-attaches every time the picker
  // toggles, and let us decide "should I open vs toggle?" using the current
  // value at event-fire time, not the value at subscribe time.
  const showNewPickerRef = useRef(false);
  useEffect(() => { showNewPickerRef.current = showNewPicker; }, [showNewPicker]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ persona?: SkillPersona }>).detail;
      if (detail?.persona) {
        setPendingPersona(detail.persona);
        // When a persona is carried in, always ensure the picker is open —
        // don't toggle it closed if it's already open (user may be re-picking).
        if (!showNewPickerRef.current) handleOpenNewPicker();
      } else {
        // Plain + button: toggle behavior (open/close).
        handleOpenNewPicker();
      }
    };
    window.addEventListener('aegis:open-new-session-picker', handler);
    return () => window.removeEventListener('aegis:open-new-session-picker', handler);
  }, [handleOpenNewPicker]);

  const handleOpenMainSession = useCallback((agentId: string, persona?: SkillPersona | null) => {
    const sessionKey = `agent:${agentId}:main`;
    openTab(sessionKey);
    setShowNewPicker(false);
    setPendingPersona(null);
    if (persona && persona.prompt) {
      applyPersonaToSessionDraft(sessionKey, persona);
    }
  }, [openTab]);

  const handleCreateNativeSession = useCallback(async (
    agentId: string,
    persona?: SkillPersona | null,
  ): Promise<boolean> => {
    if (creatingSession) return false;
    setCreatingSession(true);
    try {
      const result = await createNativeSession({
        agentId,
        label: t('chat.newSessionLabel'),
      });
      if (!result.ok) {
        useNotificationStore.getState().addToast('error', t('chat.newSession'), result.error);
        return false;
      }
      setPendingPersona(null);
      if (persona?.prompt) applyPersonaToSessionDraft(result.session.key, persona);
      return true;
    } finally {
      setCreatingSession(false);
    }
  }, [creatingSession, t]);

  const agents = useGatewayDataStore((s) => s.agents);
  const mainAgentName = agents.find((a) => a.id === 'main')?.name || t('agents.mainAgent');

  // ── Tooltip (hover on any agent's canonical session tab). Rendered in a
  // portal so the tab strip cannot clip it. ──
  const [tooltipTarget, setTooltipTarget] = useState<{ key: string; left: number; top: number } | null>(null);
  const tooltipTimeout = useRef<ReturnType<typeof setTimeout>>();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const updateTooltipPosition = useCallback(() => {
    setTooltipTarget((current) => {
      if (!current) return null;
      const element = Array.from(
        scrollContainerRef.current?.querySelectorAll<HTMLElement>('[data-agent-status-tab]') ?? [],
      ).find((candidate) => candidate.dataset.agentStatusTab === current.key);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { key: current.key, left: rect.left, top: rect.bottom + 8 };
    });
  }, []);

  useEffect(() => {
    if (!tooltipTarget) return;
    updateTooltipPosition();
    const el = scrollContainerRef.current;
    if (el) {
      el.addEventListener('scroll', updateTooltipPosition);
      return () => el.removeEventListener('scroll', updateTooltipPosition);
    }
  }, [tooltipTarget, updateTooltipPosition]);

  useEffect(() => {
    const activeEl = scrollContainerRef.current?.querySelector<HTMLElement>('[data-active-session-tab="true"]');
    activeEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeSessionKey, openTabs]);

  const handleAgentStatusTabEnter = useCallback((key: string, target: HTMLDivElement) => {
    const rect = target.getBoundingClientRect();
    tooltipTimeout.current = setTimeout(() => {
      setTooltipTarget({ key, left: rect.left, top: rect.bottom + 8 });
    }, 400);
  }, []);
  const handleAgentStatusTabLeave = useCallback(() => {
    if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
    setTooltipTarget(null);
  }, []);

  // ── Status ──
  const statusDotClass = connected
    ? 'bg-aegis-primary'
    : connecting
      ? 'bg-aegis-warning animate-pulse'
      : 'bg-aegis-danger';

  const statusLabel = connected
    ? t('connection.connected')
    : connecting
      ? t('connection.connecting')
      : t('connection.disconnected');

  // ── Tab close (middle-click support) ──
  const handleTabClose = useCallback((e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    closeTab(key);
  }, [closeTab]);

  const handleTabAuxClick = useCallback((e: React.MouseEvent, key: string) => {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(key);
    }
  }, [closeTab]);

  // ── Right-click context menu ──
  const [ctxMenu, setCtxMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ctxMenu]);

  const handleTabContextMenu = useCallback((e: React.MouseEvent, key: string) => {
    e.preventDefault();
    setCtxMenu({ key, x: e.clientX, y: e.clientY });
  }, []);

  const startRename = useCallback((key: string, currentLabel: string) => {
    setEditingKey(key);
    setEditingLabel(currentLabel);
    setRenameError(null);
  }, []);

  const cancelRename = useCallback(() => {
    setEditingKey(null);
    setEditingLabel('');
    setRenameError(null);
  }, []);

  const submitRename = useCallback(async (key: string, nativeLabel: string) => {
    if (renaming) return;
    if (editingLabel.trim() === nativeLabel.trim()) {
      cancelRename();
      return;
    }
    setRenaming(true);
    try {
      const result = await applySessionRename(key, editingLabel);
      if (result.ok) cancelRename();
      else setRenameError(result.error);
    } finally {
      setRenaming(false);
    }
  }, [editingLabel, renaming, cancelRename]);

  return (
    <div
      className="shrink-0 flex items-center h-[38px] bg-[var(--aegis-bg-frosted-60)] backdrop-blur-xl border-b border-[rgb(var(--aegis-overlay)/0.06)] relative z-20"
      role="tablist"
      aria-label={t('chat.sessions')}
    >
      {hasMultipleTabs && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => switchRelativeTab(-1)}
              disabled={!canSwitchPrev}
              className={clsx(
                'h-full w-8 shrink-0 flex items-center justify-center border-r border-[rgb(var(--aegis-overlay)/0.06)] transition-colors',
                canSwitchPrev
                  ? 'text-aegis-text-muted hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)]'
                  : 'text-aegis-text-dim/35 cursor-not-allowed',
              )}
              aria-label={t('chat.previousSession')}
            >
              <ChevronLeft size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('chat.previousSession')}</TooltipContent>
        </Tooltip>
      )}

      {/* ── Scrollable tab strip ── */}
      <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div ref={scrollContainerRef} className="flex-1 flex items-end h-full overflow-x-auto scrollbar-none min-w-0 pl-1">
        <SortableContext items={openTabs} strategy={horizontalListSortingStrategy}>
        {openTabs.map((key) => {
          const isActive = key === activeSessionKey;
          const isMain = isAgentMainSession(key);
          const { isMainSession } = parseSessionKey(key);
          const session = sessions.find((s) => s.key === key);
          const label = sessionLabel(session, key, agents, mainAgentName, messagesPerSession[key]);
          const fullLabel = session?.topic
            || (session?.lastMessage && !isWeakSessionTopic(session.lastMessage) ? session.lastMessage : '')
            || session?.label
            || label;
          const unread = session?.unread ?? 0;
          const isEditing = editingKey === key;

          return (
            <SortableTab id={key} disabled={isMain}>
	            <div
	              key={key}
	              className="group/tab relative shrink-0"
                  data-active-session-tab={isActive ? 'true' : undefined}
	              data-agent-status-tab={isMainSession ? key : undefined}
	              onMouseEnter={isMainSession ? (event) => handleAgentStatusTabEnter(key, event.currentTarget) : undefined}
              onMouseLeave={isMainSession ? handleAgentStatusTabLeave : undefined}
              onContextMenu={(e) => handleTabContextMenu(e, key)}
            >
              {/* Tab button */}
              <button
                role="tab"
                aria-selected={isActive}
                title={fullLabel}
                onClick={() => isActive ? undefined : setActiveSession(key)}
                onAuxClick={(e) => !isMain && handleTabAuxClick(e, key)}
                className={clsx(
                  'isolate flex items-center gap-1.5 h-[38px] pl-3 text-[12px] font-medium select-none relative',
                  'transition-[color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-none active:scale-[0.985]',
                  isMain ? 'pr-3' : 'pr-10',
                  isActive
                    ? 'text-aegis-text'
                    : 'text-aegis-text-dim hover:text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.03)]',
                )}
              >
                {isActive && (
                  <ActiveTabIndicator
                    layoutId="chat-active-session-tab"
                    className="inset-0 -z-10 border-b-2 border-aegis-primary bg-[rgb(var(--aegis-overlay)/0.04)]"
                  />
                )}
                {/* Canonical agent sessions share the same status affordance. */}
                {isMainSession ? (
                  <>
                    <div className={clsx('w-[6px] h-[6px] rounded-full shrink-0', statusDotClass)} title={statusLabel} />
                    <Shield size={12} className={clsx('shrink-0', isActive ? 'text-aegis-primary' : 'text-aegis-text-dim')} />
                  </>
                ) : (
                  <FilePlus size={12} className={clsx('shrink-0 opacity-60', isActive ? 'text-aegis-primary' : 'text-aegis-text-dim')} />
                )}

                {/* Label (double-click to rename) */}
                {isEditing ? (
                  <input
                    autoFocus
                    value={editingLabel}
                    onChange={(e) => setEditingLabel(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={cancelRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void submitRename(key, session?.label ?? '');
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelRename();
                      }
                    }}
                    aria-invalid={renameError ? true : undefined}
                    title={renameError ?? undefined}
                    className={clsx(
                      'max-w-[180px] min-w-[80px] h-[22px] px-1.5 rounded bg-aegis-bg border text-[12px] text-aegis-text outline-none',
                      renameError ? 'border-aegis-danger/60' : 'border-aegis-primary/40',
                    )}
                    disabled={renaming}
                  />
                ) : (
                  <span
                    className="max-w-[220px] truncate"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startRename(key, label);
                    }}
                    title={t('chat.renameSessionHint')}
                  >
                    {label}
                  </span>
                )}
                {unread > 0 && !isActive && (
                  <span
                    className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-aegis-primary/15 text-aegis-primary text-[10px] font-semibold leading-[18px] text-center"
                    title={t('chat.tabUnreadCount', { count: unread })}
                  >
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}

              </button>
              {!isMain && (
                <span className="absolute right-1 top-1/2 z-20 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover/tab:opacity-100 group-focus-within/tab:opacity-100">
                  <IconButton
                    size="xs"
                    aria-label={t('chat.closeTab')}
                    title={t('chat.closeTab')}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => handleTabClose(event, key)}
                  >
                    <X size={12} />
                  </IconButton>
                </span>
              )}

            </div>
            </SortableTab>
          );
        })}
        </SortableContext>
      </div>
      </DndContext>

      {hasMultipleTabs && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => switchRelativeTab(1)}
              disabled={!canSwitchNext}
              className={clsx(
                'h-full w-8 shrink-0 flex items-center justify-center border-l border-[rgb(var(--aegis-overlay)/0.06)] transition-colors',
                canSwitchNext
                  ? 'text-aegis-text-muted hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)]'
                  : 'text-aegis-text-dim/35 cursor-not-allowed',
              )}
              aria-label={t('chat.nextSession')}
            >
              <ChevronRight size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('chat.nextSession')}</TooltipContent>
        </Tooltip>
      )}

      {collaboration && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={collaboration.openHistory}
              disabled={!collaboration.available}
              className="relative h-full w-8 shrink-0 border-l border-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-muted transition-colors hover:bg-aegis-primary/[0.06] hover:text-aegis-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-aegis-text-muted"
              aria-label={t('collaboration.drawer.title')}
            >
              <GitFork size={14} className="mx-auto" aria-hidden />
              {collaboration.runs.length > 0 && (
                <span className="absolute end-0.5 top-1 min-w-3 rounded-full bg-aegis-primary px-0.5 text-center text-[8px] leading-3 text-white">
                  {collaboration.runs.length > 9 ? '9+' : collaboration.runs.length}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('collaboration.drawer.title')}</TooltipContent>
        </Tooltip>
      )}

      {/* Tooltip rendered in portal so it is not clipped by overflow-x-auto */}
      {tooltipTarget &&
        createPortal(
          <div style={{ position: 'fixed', left: tooltipTarget.left, top: tooltipTarget.top, zIndex: 9999 }}>
            {(() => {
              const session = sessions.find((candidate) => candidate.key === tooltipTarget.key);
              if (!session) return null;
              const { agentId } = parseSessionKey(session.key);
              const agent = agents.find((candidate) => candidate.id === agentId);
              const agentName = getAgentDisplayName(agent, agentId === 'main' ? mainAgentName : agentId);
              const status = resolveAgentStatusSnapshot({
                session,
                activeSessionKey,
                activeTokenUsage: tokenUsage,
                activeThinkingLevel: currentThinking,
                defaultContextTokens: sessionDefaults.contextTokens,
              });
              return (
                <AgentStatusTooltip
                  visible
                  tokenUsage={status.tokenUsage}
                  connected={connected}
                  agentName={agentName}
                  session={session}
                  agentRuntime={status.agentRuntime}
                  thinkingLevel={status.thinkingLevel}
                  thinkingLevels={status.thinkingLevels}
                  thinkingDefault={status.thinkingDefault}
                />
              );
            })()}
          </div>,
          document.body,
        )}

      {/* ── Tab context menu (right-click) ── */}
      {ctxMenu && (() => {
        const session = sessions.find((candidate) => candidate.key === ctxMenu.key);
        if (!session) return null;
        return createPortal(
          <div
            ref={ctxMenuRef}
            className="fixed z-[9999]"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <SessionActionsMenu
              session={session}
              onDismiss={() => setCtxMenu(null)}
              onRequestRename={() => {
                startRename(
                  session.key,
                  sessionLabel(session, session.key, agents, mainAgentName, messagesPerSession[session.key]),
                );
              }}
              onOpenSession={(key) => openTab(key)}
              onCloseTab={() => closeTab(session.key)}
            />
          </div>,
          document.body,
        );
      })()}

      <div className="relative shrink-0 h-full" ref={newPickerRef}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('aegis:open-new-session-picker'))}
              data-tour="chat-new-session"
              className={clsx(
                'h-full w-9 flex items-center justify-center border-l border-[rgb(var(--aegis-overlay)/0.06)] transition-colors',
                'text-aegis-text-muted hover:text-aegis-primary hover:bg-aegis-primary/[0.06]',
                showNewPicker && 'text-aegis-primary bg-aegis-primary/[0.06]',
              )}
              aria-label={t('chat.newSession')}
            >
              <Plus size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('chat.newSession')}</TooltipContent>
        </Tooltip>
        <NewSessionPicker
          open={showNewPicker}
          onClose={() => { setShowNewPicker(false); setPendingPersona(null); }}
          onOpenExisting={(key) => openTab(key)}
          onOpenMainSession={handleOpenMainSession}
          onCreateNativeSession={handleCreateNativeSession}
          creatingSession={creatingSession}
          openTabs={openTabs}
          loadingNew={loadingNew}
          newSessions={newSessions}
          setNewSessions={setNewSessions}
          messagesPerSession={messagesPerSession}
          agents={agents}
          activeSessionKey={activeSessionKey}
          initialPersona={pendingPersona}
          defaultPersonaFor={getAgentDefaultPersona}
          onClearPersona={() => setPendingPersona(null)}
          onClearDefaultPersona={(agentId) => setAgentDefaultPersona(agentId, null)}
        />
      </div>
    </div>
  );
}
