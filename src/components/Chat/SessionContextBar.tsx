import { useEffect, useRef, useState } from 'react';
import { Activity, Check, ChevronDown, Download, Folder, Plus, Puzzle, RotateCcw, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { gateway } from '@/services/gateway';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { ModelDropdown } from '@/components/shared/ModelDropdown';
import { exportChatMarkdown } from '@/utils/exportChat';
import { getAgentDisplayName } from '@/utils/agentDisplayName';
import { setSessionModelPref } from '@/utils/sessionModelPrefs';
import { debugError } from '@/utils/debugLog';
import { StatusBadge, type LifecycleState } from '@/components/shared/StatusBadge';
import { useSkillsStore } from '@/stores/skillsStore';
import { sessionExecutionState } from '@/utils/sessionPresentation';

const THINKING_LEVELS = [
  { id: 'auto', label: 'Auto' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'off', label: 'Off' },
];

function SessionModelPicker({ currentModel }: { currentModel: string | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [switching, setSwitching] = useState(false);
  const { setManualModelOverride, setSessionModel, manualModelOverride, availableModels, addMessage } = useChatStore();
  const activeSessionKey = useChatStore((s) => s.activeSessionKey);
  const effectiveModel = manualModelOverride ?? currentModel;

  const handleSelect = async (modelId: string) => {
    if (switching) return;
    setSwitching(true);
    try {
      const sessionKey = activeSessionKey || 'agent:main:main';
      await gateway.setSessionModel(modelId, sessionKey);
      setSessionModel(sessionKey, modelId);
      setManualModelOverride(modelId);
      setSessionModelPref(sessionKey, modelId);
      // Drop a system notice into the chat so the switch is visible in-stream.
      const fromModel = effectiveModel || '';
      if (fromModel && fromModel !== modelId) {
        addMessage({
          id: `model-switch-${Date.now()}`,
          role: 'system',
          kind: 'model-switch',
          content: JSON.stringify({ from: fromModel, to: modelId }),
          timestamp: new Date().toISOString(),
        }, sessionKey);
      }
      setTimeout(() => window.dispatchEvent(new Event('aegis:model-changed')), 500);
    } catch (err) {
      debugError('models', '[SessionModelPicker] Failed to switch model:', err);
    } finally {
      setSwitching(false);
    }
  };

  if (availableModels.length === 0) {
    return (
      <button
        type="button"
        onClick={() => navigate('/config')}
        className={clsx(
          'no-drag flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono transition-all duration-150',
          'text-aegis-warning hover:text-aegis-warning/80',
          'hover:bg-aegis-warning/[0.08] border border-aegis-warning/30',
        )}
        title={t('config.addFirstProvider', 'Add your first AI provider to get started')}
      >
        <span>{t('config.setupProviderShort', 'Setup →')}</span>
      </button>
    );
  }

  return (
    <div className="no-drag">
      <ModelDropdown
        value={switching ? null : effectiveModel}
        onChange={handleSelect}
        variant="pill"
        placeholder={switching ? '…' : t('config.notSet', 'Not set')}
        disabled={switching}
      />
    </div>
  );
}

function WorkspacePicker({ agentId, current }: { agentId: string; current?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('aegis:recent-workspaces') || '[]'); } catch { return []; }
  });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const persist = (ws: string) => {
    const next = [ws, ...recents.filter((w) => w !== ws)].slice(0, 8);
    setRecents(next);
    localStorage.setItem('aegis:recent-workspaces', JSON.stringify(next));
  };
  const switchTo = async (ws: string) => {
    setOpen(false);
    setQuery('');
    persist(ws);
    try { await gateway.updateAgent(agentId, { workspace: ws }); } catch (e) { debugError('app', '[WorkspacePicker] switch failed:', e); }
  };
  const pickFolder = async () => {
    const openDialog = (window.aegis?.file as any)?.openDialog;
    const result = typeof openDialog === 'function' ? await openDialog({ properties: ['openDirectory'] }) : null;
    if (result?.filePaths?.[0]) await switchTo(result.filePaths[0]);
  };
  const label = current ? (current.split(/[\\/]/).pop() || current) : t('chat.workspaceDefault', 'default');
  const filtered = query.trim()
    ? recents.filter((ws) => ws.toLowerCase().includes(query.toLowerCase()) || (ws.split(/[\\/]/).pop() || '').toLowerCase().includes(query.toLowerCase()))
    : recents;

  return (
    <div ref={ref} className="relative no-drag">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] text-aegis-text-muted hover:text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors"
        title={current || t('chat.workspaceDefault', 'default')}
      >
        <Folder size={11} />
        <span className="font-mono max-w-[120px] truncate">{label}</span>
        <ChevronDown size={9} className={clsx('transition-transform duration-150', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-[260px] rounded-xl overflow-hidden bg-aegis-menu-bg border border-aegis-menu-border" style={{ boxShadow: 'var(--aegis-menu-shadow)' }}>
          <div className="p-2 border-b border-[rgb(var(--aegis-overlay)/0.06)]">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('chat.workspaceSearch', 'Search workspaces…')}
              className="w-full rounded-md bg-[rgb(var(--aegis-overlay)/0.06)] px-2 py-1 text-[11px] text-aegis-text placeholder:text-aegis-text-dim outline-none focus:bg-[rgb(var(--aegis-overlay)/0.1)]"
            />
          </div>
          <div className="max-h-[200px] overflow-y-auto scrollbar-hidden">
            {filtered.length > 0 ? filtered.map((ws) => {
              const isActive = current === ws;
              const name = ws.split(/[\\/]/).pop() || ws;
              return (
                <button key={ws} onClick={() => switchTo(ws)} className={clsx('w-full text-start px-3 py-1.5 text-[11px] truncate font-mono transition-colors', isActive ? 'bg-aegis-primary/10 text-aegis-primary' : 'text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.06)]')} title={ws}>
                  <span className="font-sans font-medium">{name}</span>
                  <span className="ml-1.5 text-[10px] text-aegis-text-dim">{ws}</span>
                </button>
              );
            }) : (
              <div className="px-3 py-2 text-[11px] text-aegis-text-dim">{t('chat.workspaceNoResults', 'No match')}</div>
            )}
          </div>
          <div className="border-t border-[rgb(var(--aegis-overlay)/0.06)]">
            <button onClick={pickFolder} className="w-full flex items-center gap-1.5 text-start px-3 py-2 text-[11px] text-aegis-primary hover:bg-aegis-primary/10 transition-colors">
              <Plus size={11} /> {t('chat.workspacePick', 'Choose folder…')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SessionThinkingPicker({ currentThinking }: { currentThinking: string | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { setCurrentThinking } = useChatStore();
  const activeSessionKey = useChatStore((s) => s.activeSessionKey);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = async (level: string) => {
    if (switching) return;
    setOpen(false);
    setSwitching(true);
    try {
      const sessionKey = activeSessionKey || 'agent:main:main';
      const nextLevel = level === 'auto' ? null : level;
      await gateway.setSessionThinking(nextLevel, sessionKey);
      setCurrentThinking(nextLevel);
    } catch (err) {
      debugError('app', '[SessionThinkingPicker] Failed to switch thinking:', err);
    } finally {
      setSwitching(false);
    }
  };

  const currentThinkingId = currentThinking ?? 'auto';
  const active = THINKING_LEVELS.find((it) => it.id === currentThinkingId);
  const displayLabel = t(`titlebar.thinking.levels.${active?.id ?? 'auto'}`, active?.label ?? 'Auto');

  return (
    <div ref={ref} className="relative no-drag">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={switching}
        aria-label={t('titlebar.thinking.ariaLabel', { level: displayLabel })}
        title={t('titlebar.thinking.ariaLabel', { level: displayLabel })}
        className={clsx(
          'flex items-center gap-1.5 px-1.5 py-0.5 rounded-md text-[11px] transition-all duration-150',
          'text-aegis-text-muted hover:text-aegis-text-secondary',
          'hover:bg-[rgb(var(--aegis-overlay)/0.06)]',
          open && 'bg-[rgb(var(--aegis-overlay)/0.08)]',
          switching && 'opacity-60 cursor-wait',
        )}
      >
        <span className="text-[10px] uppercase tracking-[0.5px] text-aegis-text-dim">
          {t('titlebar.thinking.label')}
        </span>
        <span className="font-mono text-aegis-text-secondary">
          {switching ? t('titlebar.thinking.updating') : displayLabel}
        </span>
        <ChevronDown size={9} className={clsx('transition-transform duration-150', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-50 min-w-[150px] rounded-xl overflow-hidden bg-aegis-menu-bg border border-aegis-menu-border"
          style={{ boxShadow: 'var(--aegis-menu-shadow)' }}
        >
          {THINKING_LEVELS.map((level) => {
            const isActive = currentThinkingId === level.id;
            return (
              <button
                key={level.id}
                onClick={() => handleSelect(level.id)}
                className={clsx(
                  'w-full flex items-center justify-between px-3 py-2 text-[12px] text-start transition-colors',
                  isActive
                    ? 'text-aegis-primary bg-[rgb(var(--aegis-primary)/0.08)]'
                    : 'text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.06)]',
                )}
              >
                <span className="font-mono">{t(`titlebar.thinking.levels.${level.id}`, level.label)}</span>
                {isActive && <Check size={11} className="text-aegis-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SessionContextBar() {
  const { t } = useTranslation();
  const { tokenUsage, currentModel, currentThinking, availableModels, renderBlocks, activeSessionKey, messagesPerSession, sessions, typingBySession } = useChatStore();
  const agents = useGatewayDataStore((s) => s.agents);
  const skills = useSkillsStore((s) => s.skills);
  const refreshSkills = useSkillsStore((s) => s.refresh);
  const navigate = useNavigate();
  const hasProviders = availableModels.length > 0;
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRefreshed, setIsRefreshed] = useState(false);

  // Parse agentId from session key (same logic as ChatTabs)
  const keyParts = activeSessionKey.split(':');
  const agentId = keyParts.length >= 3 ? (keyParts[1] ?? 'main') : 'main';
  const agent = agents.find((a) => a.id === agentId);
  const mainAgentName = getAgentDisplayName(agents.find((a) => a.id === 'main'), t('agents.mainAgent', 'Main Agent'));
  const agentDisplayName = getAgentDisplayName(agent, agentId === 'main' ? mainAgentName : agentId);
  const activeSession = sessions.find((session) => session.key === activeSessionKey);
  const executionState = typingBySession[activeSessionKey]
    ? 'running'
    : activeSession
      ? sessionExecutionState(activeSession)
      : 'unknown';
  const lifecycle: LifecycleState = executionState === 'running'
    ? 'running'
    : executionState === 'failed'
      ? 'failed'
      : executionState === 'done'
        ? 'ended'
        : 'idle';
  const lifecycleLabel = executionState === 'running'
    ? t('lifecycle.running', '运行中')
    : executionState === 'failed'
      ? t('lifecycle.failed', '失败')
      : executionState === 'done'
        ? t('lifecycle.ended', '已完成')
        : t('lifecycle.idle', '空闲');
  const enabledSkillCount = Object.values(skills).filter((skill) => skill.enabled !== false).length;

  useEffect(() => {
    void refreshSkills();
  }, [refreshSkills]);

  const usedTokens = tokenUsage?.contextTokens || 0;
  const maxTokens = tokenUsage?.maxTokens || 0;
  const usedK = Math.round(usedTokens / 1000);
  const maxLabel = maxTokens >= 1_000_000
    ? `${(maxTokens / 1_000_000).toFixed(maxTokens % 1_000_000 === 0 ? 0 : 1)}M`
    : `${Math.round(maxTokens / 1000)}K`;

  return (
    <div className="h-[32px] shrink-0 flex items-center gap-2 px-3 border-b border-[rgb(var(--aegis-overlay)/0.06)] bg-[var(--aegis-bg-frosted-60)]">
      <span className="text-[10px] uppercase tracking-[0.5px] text-aegis-text-dim" title={agentDisplayName}>
        {agentDisplayName}
      </span>
      <WorkspacePicker agentId={agentId} current={agent?.workspace} />

      <span className="hidden items-center gap-1.5 xl:inline-flex">
        <StatusBadge state={lifecycle} label size={7} labelText={lifecycleLabel} />
      </span>

      <SessionModelPicker currentModel={currentModel} />
      {hasProviders && (
        <>
          <span className="text-aegis-text-dim opacity-40">·</span>
          <SessionThinkingPicker currentThinking={currentThinking} />
        </>
      )}
      <div className="ms-auto flex items-center gap-2 pl-2 border-l border-[rgb(var(--aegis-overlay)/0.06)]">
        <div className="hidden items-center gap-0.5 lg:flex">
          <button
            type="button"
            onClick={() => navigate('/skills')}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text-secondary"
            title={t('activity.skillsHint', '查看当前可用技能')}
          >
            <Puzzle size={11} />{enabledSkillCount}
          </button>
          <button
            type="button"
            onClick={() => navigate('/tools')}
            className="inline-flex items-center rounded-md px-1.5 py-1 text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text-secondary"
            title={t('activity.mcpHint', '查看 MCP 工具')}
          >
            <Wrench size={11} />
          </button>
          <button
            type="button"
            onClick={() => navigate('/activity')}
            className="inline-flex items-center rounded-md px-1.5 py-1 text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text-secondary"
            title={t('activity.open', '打开活动中心')}
          >
            <Activity size={11} />
          </button>
        </div>
        {maxTokens > 0 && (
          <span className="text-[10px] text-aegis-text-muted font-mono hidden lg:inline" title={`${usedK}K / ${maxLabel} (${Math.round((usedTokens / maxTokens) * 100)}%)`}>
            {usedK}K/{maxLabel}
          </span>
        )}
        {renderBlocks.length > 0 && (
          <button
            onClick={() => exportChatMarkdown(renderBlocks, activeSessionKey)}
            className="p-1.5 rounded-md transition-colors text-aegis-text-dim hover:text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.05)]"
            title={t('chat.exportMarkdown', 'Export as Markdown')}
          >
            <Download size={13} />
          </button>
        )}
        <button
          onClick={() => {
            if (isRefreshing) return;
            setIsRefreshed(false);
            setIsRefreshing(true);
            window.dispatchEvent(new Event('aegis:refresh'));
            setTimeout(() => {
              setIsRefreshing(false);
              setIsRefreshed(true);
              setTimeout(() => setIsRefreshed(false), 1200);
            }, 800);
          }}
          className={clsx(
            'p-1.5 rounded-md transition-colors text-aegis-text-dim hover:text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.05)]',
            isRefreshing && 'opacity-50 cursor-wait',
            isRefreshed && 'text-aegis-success hover:text-aegis-success',
          )}
          title={isRefreshed ? t('chat.refreshDone', 'Refreshed') : t('chat.refresh', 'Refresh chat')}
        >
          {isRefreshed
            ? <Check size={13} />
            : <RotateCcw size={13} className={clsx('transition-transform', isRefreshing && 'animate-spin')} />}
        </button>
        <button
          onClick={() => window.dispatchEvent(new Event('aegis:open-new-session-picker'))}
          className="p-1.5 rounded-md transition-colors text-aegis-text-dim hover:text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.05)]"
          title={t('chat.newTab', 'New tab')}
        >
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}
