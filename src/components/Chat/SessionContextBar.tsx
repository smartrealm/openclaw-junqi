import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, Check, ChevronDown, Crosshair, Download, FileDown, FileText, Folder, Plus, Puzzle, RefreshCw, RotateCcw, Wrench, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { gateway } from '@/services/gateway';
import { useChatStore } from '@/stores/chatStore';
import {
  ensureSessionArtifactsFresh,
  saveSessionArtifact,
  useGatewayDataStore,
  type OpenClawArtifactSummary,
} from '@/stores/gatewayDataStore';
import { exportChatMarkdown } from '@/utils/exportChat';
import { getAgentDisplayName } from '@/utils/agentDisplayName';
import { debugError } from '@/utils/debugLog';
import { useSkillsStore } from '@/stores/skillsStore';
import { useFocusContextStore } from '@/stores/focusContextStore';
import { OPENCLAW_TOOLS_ROUTE } from '@/config/openClawToolsRoute';
import { SessionRuntimeControl } from './session-runtime/SessionRuntimeControl';
import { EffectiveToolsControl } from './EffectiveToolsControl';
import { SessionInspectionControl } from './SessionInspectionControl';
import { SessionArtifactsControl } from './SessionArtifactsControl';
import { desktopFileRuntime } from '@/services/chat/desktopFileRuntime';

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
    const directory = await desktopFileRuntime.selectDirectory();
    if (directory) await switchTo(directory);
  };
  const label = current ? (current.split(/[\\/]/).pop() || current) : t('chat.workspaceDefault');
  const filtered = query.trim()
    ? recents.filter((ws) => ws.toLowerCase().includes(query.toLowerCase()) || (ws.split(/[\\/]/).pop() || '').toLowerCase().includes(query.toLowerCase()))
    : recents;

  return (
    <div ref={ref} className="relative no-drag">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] text-aegis-text-muted hover:text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors"
        title={current || t('chat.workspaceDefault')}
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
              placeholder={t('chat.workspaceSearch')}
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
              <div className="px-3 py-2 text-[11px] text-aegis-text-dim">{t('chat.workspaceNoResults')}</div>
            )}
          </div>
          <div className="border-t border-[rgb(var(--aegis-overlay)/0.06)]">
            <button onClick={pickFolder} className="w-full flex items-center gap-1.5 text-start px-3 py-2 text-[11px] text-aegis-primary hover:bg-aegis-primary/10 transition-colors">
              <Plus size={11} /> {t('chat.workspacePick')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatArtifactSize(sizeBytes?: number): string | null {
  if (sizeBytes === undefined || !Number.isFinite(sizeBytes) || sizeBytes < 0) return null;
  if (sizeBytes >= 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  if (sizeBytes >= 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${sizeBytes} B`;
}

function SessionArtifactsButton({ sessionKey, agentId }: { sessionKey: string; agentId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const artifacts = useGatewayDataStore((state) => state.sessionArtifacts[sessionKey] ?? []);
  const loading = useGatewayDataStore((state) => state.sessionArtifactsLoading)
    && useGatewayDataStore((state) => state.sessionArtifactsLoadingKey) === sessionKey;
  const error = useGatewayDataStore((state) => state.sessionArtifactsError);

  const refresh = useCallback(() => {
    setSaveError(null);
    void ensureSessionArtifactsFresh(sessionKey, undefined, agentId);
  }, [agentId, sessionKey]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleSave = useCallback(async (artifact: OpenClawArtifactSummary) => {
    if (savingId || artifact.download.mode === 'unsupported') return;
    setSavingId(artifact.id);
    setSaveError(null);
    const result = await saveSessionArtifact(sessionKey, artifact.id, agentId);
    setSavingId(null);
    if (!result.success && !result.canceled) setSaveError(result.errorCode ?? 'OPENCLAW_ARTIFACT_SAVE_FAILED');
  }, [agentId, savingId, sessionKey]);

  const errorLabel = error === 'OPENCLAW_ARTIFACTS_UNSUPPORTED'
    ? t('chat.artifacts.unavailable')
    : t('chat.artifacts.error');
  const saveErrorLabel = saveError === 'OPENCLAW_ARTIFACT_DOWNLOAD_UNSUPPORTED'
    ? t('chat.artifacts.unsupported')
    : t('chat.artifacts.saveFailed');

  return (
    <div className="relative no-drag">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={t('chat.artifacts.open')}
        title={t('chat.artifacts.open')}
        className="relative inline-flex items-center rounded-md px-1.5 py-1 text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text-secondary"
      >
        <FileText size={11} />
        {artifacts.length > 0 ? (
          <span className="ms-0.5 min-w-3 text-[9px] font-mono tabular-nums">{artifacts.length}</span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute end-0 top-full z-50 mt-1 w-[min(92vw,420px)] overflow-hidden rounded-xl border border-aegis-border bg-aegis-menu-bg shadow-float">
          <div className="flex items-center gap-2 border-b border-[rgb(var(--aegis-overlay)/0.08)] px-3 py-2">
            <FileText size={13} className="shrink-0 text-aegis-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold text-aegis-text">{t('chat.artifacts.title')}</p>
              <p className="truncate text-[10px] text-aegis-text-dim">{sessionKey}</p>
            </div>
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              aria-label={t('chat.artifacts.refresh')}
              title={t('chat.artifacts.refresh')}
              className="grid size-7 place-items-center rounded-md text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text disabled:cursor-wait disabled:opacity-50"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('common.close')}
              title={t('common.close')}
              className="grid size-7 place-items-center rounded-md text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
          <div className="max-h-[min(62vh,420px)] overflow-y-auto p-2">
            {loading && artifacts.length === 0 ? (
              <div className="flex items-center gap-2 px-2 py-6 text-[11px] text-aegis-text-dim" role="status">
                <RefreshCw size={13} className="animate-spin" aria-hidden="true" />
                {t('chat.artifacts.loading')}
              </div>
            ) : error && artifacts.length === 0 ? (
              <div className="flex items-start gap-2 rounded-lg border border-aegis-warning/25 bg-aegis-warning/5 px-2.5 py-2.5 text-[11px] text-aegis-text-secondary">
                <AlertCircle size={13} className="mt-0.5 shrink-0 text-aegis-warning" aria-hidden="true" />
                <span>{errorLabel}</span>
              </div>
            ) : artifacts.length === 0 ? (
              <div className="px-2 py-6 text-center text-[11px] text-aegis-text-dim">
                {t('chat.artifacts.empty')}
              </div>
            ) : (
              <div className="space-y-1.5">
                {artifacts.map((artifact) => {
                  const size = formatArtifactSize(artifact.sizeBytes);
                  const unsupported = artifact.download.mode === 'unsupported';
                  return (
                    <div key={artifact.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.03)] px-2.5 py-2">
                      <FileText size={14} className="shrink-0 text-aegis-text-muted" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-medium text-aegis-text" title={artifact.title}>{artifact.title}</p>
                        <p className="truncate text-[10px] text-aegis-text-dim">
                          {[artifact.type, size, artifact.mimeType].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleSave(artifact)}
                        disabled={unsupported || savingId !== null}
                        aria-label={unsupported
                          ? t('chat.artifacts.unsupported')
                          : t('chat.artifacts.save')}
                        title={unsupported
                          ? t('chat.artifacts.unsupported')
                          : t('chat.artifacts.save')}
                        className="grid size-7 shrink-0 place-items-center rounded-md text-aegis-text-muted transition-colors hover:bg-aegis-primary/10 hover:text-aegis-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {savingId === artifact.id ? <RefreshCw size={12} className="animate-spin" aria-hidden="true" /> : <FileDown size={12} aria-hidden="true" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {saveError ? (
              <p className="mt-2 flex items-center gap-1.5 px-1 text-[10px] text-aegis-warning" role="status">
                <AlertCircle size={12} aria-hidden="true" />
                {saveErrorLabel}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SessionContextBar() {
  const { t } = useTranslation();
  const { tokenUsage, renderBlocks, activeSessionKey, sessions, compactionStatusBySession } = useChatStore();
  const agents = useGatewayDataStore((s) => s.agents);
  const skills = useSkillsStore((s) => s.skills);
  const refreshSkills = useSkillsStore((s) => s.refresh);
  const navigate = useNavigate();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRefreshed, setIsRefreshed] = useState(false);

  // Parse agentId from session key (same logic as ChatTabs)
  const keyParts = activeSessionKey.split(':');
  const agentId = keyParts.length >= 3 ? (keyParts[1] ?? 'main') : 'main';
  const agent = agents.find((a) => a.id === agentId);
  const mainAgentName = getAgentDisplayName(agents.find((a) => a.id === 'main'), t('agents.mainAgent'));
  const agentDisplayName = getAgentDisplayName(agent, agentId === 'main' ? mainAgentName : agentId);
  const enabledSkillCount = Object.values(skills).filter((skill) => skill.enabled !== false).length;
  const activeSession = sessions.find((session) => session.key === activeSessionKey);
  const compactionActive = Boolean(compactionStatusBySession[activeSessionKey]);

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
    <div className="relative z-40 h-[32px] shrink-0 flex items-center gap-2 px-3 border-b border-[rgb(var(--aegis-overlay)/0.06)] bg-[var(--aegis-bg-frosted-60)]">
      <span className="text-[10px] uppercase tracking-[0.5px] text-aegis-text-dim" title={agentDisplayName}>
        {agentDisplayName}
      </span>
      <WorkspacePicker agentId={agentId} current={agent?.workspace} />
      <SessionRuntimeControl />
      {activeSession?.lastRunError && (
        <span
          role="status"
          className="inline-flex min-w-0 max-w-[min(38vw,340px)] items-center gap-1 text-aegis-danger"
          aria-label={t('chat.sessionLastRunFailed', { reason: activeSession.lastRunError })}
          title={t('chat.sessionLastRunFailed', { reason: activeSession.lastRunError })}
        >
          <AlertCircle size={11} className="shrink-0" aria-hidden="true" />
          <span className="hidden truncate text-[10px] lg:inline">
            {t('chat.sessionLastRunFailedShort')}
          </span>
        </span>
      )}
      <div className="ms-auto flex items-center gap-2 pl-2 border-l border-[rgb(var(--aegis-overlay)/0.06)]">
        <div className="hidden items-center gap-0.5 lg:flex">
          <button
            type="button"
            onClick={() => useFocusContextStore.getState().setFocus({
              schemaVersion: 1,
              target: { kind: 'chat-session', id: activeSessionKey },
              title: activeSession?.topic?.trim()
                || activeSession?.label?.trim()
                || t('chat.currentSession'),
              detail: agentDisplayName,
              route: `/chat?session=${encodeURIComponent(activeSessionKey)}`,
              focusedAt: Date.now(),
            })}
            className="inline-flex items-center rounded-md px-1.5 py-1 text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text-secondary"
            title={t('focus.set')}
            aria-label={t('focus.set')}
          >
            <Crosshair size={11} />
          </button>
          <SessionArtifactsButton sessionKey={activeSessionKey} agentId={agentId} />
          <button
            type="button"
            onClick={() => navigate('/skills')}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text-secondary"
            title={t('activity.skillsHint')}
          >
            <Puzzle size={11} />{enabledSkillCount}
          </button>
          <button
            type="button"
            onClick={() => navigate(OPENCLAW_TOOLS_ROUTE)}
            className="inline-flex items-center rounded-md px-1.5 py-1 text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text-secondary"
            title={t('activity.openClawToolsHint')}
          >
            <Wrench size={11} />
          </button>
          <EffectiveToolsControl
            sessionKey={activeSessionKey}
            agentId={agentId}
            onOpenConfiguration={() => navigate('/tools')}
          />
          <SessionInspectionControl sessionKey={activeSessionKey} agentId={agentId} />
          <SessionArtifactsControl sessionKey={activeSessionKey} agentId={agentId} />
          <button
            type="button"
            onClick={() => navigate('/activity')}
            className="inline-flex items-center rounded-md px-1.5 py-1 text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text-secondary"
            title={t('activity.open')}
          >
            <Activity size={11} />
          </button>
        </div>
        {maxTokens > 0 && (
          <span className="text-[10px] text-aegis-text-muted font-mono hidden lg:inline" title={`${usedK}K / ${maxLabel} (${Math.round((usedTokens / maxTokens) * 100)}%)`}>
            {usedK}K/{maxLabel}
          </span>
        )}
        {compactionActive && (
          <span
            className="inline-flex items-center gap-1 text-[10px] text-aegis-warning"
            title={t('chat.compactionInProgress')}
            aria-label={t('chat.compactionInProgress')}
          >
            <RotateCcw size={11} className="animate-spin" />
            <span className="hidden xl:inline">{t('chat.compactionInProgress')}</span>
          </span>
        )}
        {renderBlocks.length > 0 && (
          <button
            onClick={() => exportChatMarkdown(renderBlocks, activeSessionKey)}
            className="p-1.5 rounded-md transition-colors text-aegis-text-dim hover:text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.05)]"
            title={t('chat.exportMarkdown')}
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
          title={isRefreshed ? t('chat.refreshDone') : t('chat.refresh')}
        >
          {isRefreshed
            ? <Check size={13} />
            : <RotateCcw size={13} className={clsx('transition-transform', isRefreshing && 'animate-spin')} />}
        </button>
      </div>
    </div>
  );
}
