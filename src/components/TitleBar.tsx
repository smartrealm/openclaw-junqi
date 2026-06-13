import { useState, useEffect, useRef, useCallback } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { APP_VERSION } from '@/hooks/useAppVersion';
import { Power, RefreshCw, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

// ═══════════════════════════════════════════════════════════
// Title Bar — macOS traffic-light-aware context bar + gateway status
// ═══════════════════════════════════════════════════════════

// ── Route → page label + context detail ──
function useTitleContext() {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const currentModel = useChatStore((s) => s.currentModel);
  const sessions = useChatStore((s) => s.sessions);
  const activeKey = useChatStore((s) => s.activeSessionKey);

  const modelLabel = currentModel?.split('/').pop() || '';
  const active = sessions.find((s) => s.key === activeKey);
  const sessionLabel = active?.label || activeKey?.split(':').pop() || '';

  const routes: Record<string, { label: string; detail?: string }> = {
    '/chat':     { label: t('nav.chat'),     detail: [modelLabel, sessionLabel].filter(Boolean).join(' · ') },
    '/workshop': { label: t('nav.workshop') },
    '/costs':    { label: t('nav.analytics') },
    '/analytics':{ label: t('nav.analytics') },
    '/cron':     { label: t('nav.cron') },
    '/agents':   { label: t('nav.agents') },
    '/skills':   { label: t('nav.skills') },
    '/terminal': { label: t('nav.terminal') },
    '/memory':   { label: t('nav.memory') },
    '/config':   { label: t('nav.config') },
    '/files':    { label: t('nav.files') },
    '/calendar': { label: t('nav.calendar') },
    '/settings': { label: t('nav.settings') },
    '/logs':     { label: t('nav.logs') },
    '/tools':    { label: t('nav.tools') },
    '/sessions': { label: t('nav.sessions') },
    '/':         { label: t('nav.dashboard') },
  };

  const match = Object.entries(routes).find(
    ([route]) => pathname === route || pathname.startsWith(route + '?')
  );
  return match?.[1] ?? { label: 'JunQi Desktop' };
}

// ═══════════════════════════════════════════════════════════
// GatewayControl — connection status indicator
// ═══════════════════════════════════════════════════════════

function GatewayControl() {
  const { t } = useTranslation();
  const { connected, connecting, restarting, setRestarting } = useChatStore();
  const [confirming, setConfirming] = useState(false);

  const doRestart = useCallback(async () => {
    setConfirming(false);
    setRestarting(true);
    try { await window.aegis?.config?.restart?.(); }
    catch (err) { console.error('[GatewayControl] restart failed:', err); }
    finally { setRestarting(false); }
  }, [setRestarting]);

  const handleClick = useCallback(() => {
    if (restarting || connecting) return;
    connected ? setConfirming(true) : doRestart();
  }, [restarting, connecting, connected, doRestart]);

  const isIdle = !connected && !connecting && !restarting;

  if (confirming) {
    return (
      <div className="flex items-center gap-1 no-drag">
        <span className="text-[10px] text-aegis-text-muted">{t('gateway.confirmRestart')}</span>
        <button onClick={doRestart} className="px-2 py-0.5 rounded text-[10px] font-semibold bg-aegis-danger/[0.08] border border-aegis-danger/25 text-aegis-danger hover:bg-aegis-danger/[0.15]">{t('gateway.confirmYes')}</button>
        <button onClick={() => setConfirming(false)} className="px-2 py-0.5 rounded text-[10px] border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text-dim hover:border-[rgb(var(--aegis-overlay)/0.2)]">{t('gateway.confirmNo')}</button>
      </div>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={restarting || connecting}
      title={restarting ? t('gateway.restarting') : connected ? t('gateway.restartTooltip') : t('gateway.startTooltip')}
      className={clsx(
        'group flex items-center gap-[5px] px-1.5 py-0.5 rounded-md text-[11px] transition-all duration-150 no-drag border',
        (restarting || connecting) && 'opacity-60 cursor-default border-transparent text-aegis-text-dim',
        connected && 'border-transparent text-aegis-success hover:border-aegis-success/20 hover:bg-aegis-success/[0.06] cursor-pointer',
        isIdle && 'border-aegis-primary/25 text-aegis-primary bg-aegis-primary/[0.05] hover:bg-aegis-primary/[0.1] cursor-pointer',
      )}
    >
      <span className={clsx('w-[5px] h-[5px] rounded-full shrink-0',
        restarting ? 'bg-aegis-warning animate-pulse' : connected ? 'bg-aegis-success' :
        connecting ? 'bg-aegis-warning animate-pulse' : 'bg-aegis-text-dim')} />
      {restarting || connecting
        ? <Loader2 size={9} className="animate-spin shrink-0" />
        : <RefreshCw size={9} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />}
      <span>{restarting ? t('gateway.restarting') : connected ? t('gateway.connectedLabel') : connecting ? t('gateway.connectingLabel') : t('gateway.disconnectedLabel')}</span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════
export function TitleBar() {
  const platform = window.aegis?.platform ?? (navigator.userAgent.includes('Mac') ? 'darwin' : 'other');
  const isMac = platform === 'darwin';
  const isWindows = platform === 'win32';
  const { label, detail } = useTitleContext();

  return (
    <div
      dir="ltr"
      className={clsx(
        'drag-region h-[38px] flex items-center chrome-bg border-b border-aegis-border select-none shrink-0 relative z-10',
        isMac     && 'pl-[70px] pr-3',
        isWindows && 'pl-3 pr-[154px]',
        !isMac && !isWindows && 'px-3',
      )}
    >
      {/* Context — right next to macOS traffic lights */}
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-[12px] font-semibold text-aegis-text tracking-wide">{label}</span>
        {detail && (
          <span className="text-[11px] text-aegis-text-muted truncate">{detail}</span>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2.5 ml-auto">
        <GatewayControl />
      </div>
    </div>
  );
}
