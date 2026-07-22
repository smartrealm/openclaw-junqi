import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Check, ChevronDown, ChevronRight, Circle, MessageSquare, Network, Radio, RefreshCw, Settings2, Sparkles, Wifi, WifiOff } from 'lucide-react';
import type { AgentInfo, SessionInfo } from '@/stores/gatewayDataStore';
import { gateway } from '@/services/gateway';
import { GlassCard } from '@/components/shared/GlassCard';
import {
  hasMainAgent,
  hasMainAgentConversation,
  isOpenClawOnboardingComplete,
  readOpenClawOnboardingCollapsed,
  setOpenClawOnboardingCollapsed,
} from './onboardingState';
import {
  inspectOpenClawStartupRuntime,
  type OpenClawRuntimeReadiness,
  type OpenClawStartupRuntimeState,
} from './runtimeState';

interface OpenClawOnboardingProps {
  connected: boolean;
  agents: readonly AgentInfo[];
  sessions: readonly SessionInfo[];
  onNavigate: (path: string) => void;
}

const CHECKING_RUNTIME: OpenClawStartupRuntimeState = { provider: 'checking', channel: 'checking' };
const UNAVAILABLE_RUNTIME: OpenClawStartupRuntimeState = { provider: 'unavailable', channel: 'unavailable' };

function readinessDetail(
  readiness: OpenClawRuntimeReadiness,
  ready: string,
  needed: string,
  checking: string,
  unavailable: string,
): string {
  if (readiness === 'ready') return ready;
  if (readiness === 'checking') return checking;
  if (readiness === 'unavailable') return unavailable;
  return needed;
}

export function OpenClawOnboarding({ connected, agents, sessions, onNavigate }: OpenClawOnboardingProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(readOpenClawOnboardingCollapsed);
  const [runtime, setRuntime] = useState<OpenClawStartupRuntimeState>(CHECKING_RUNTIME);
  const [inspection, setInspection] = useState(0);
  const conversationReady = hasMainAgentConversation(sessions);
  const mainAgentReady = hasMainAgent(agents);

  useEffect(() => {
    let cancelled = false;
    if (!connected) {
      setRuntime(UNAVAILABLE_RUNTIME);
      return () => { cancelled = true; };
    }
    setRuntime(CHECKING_RUNTIME);
    void inspectOpenClawStartupRuntime({
      call: (method, params) => gateway.call(method, params),
      readChannelStatus: () => window.aegis.channelRuntime.status(undefined, false),
    })
      .then((snapshot) => {
        if (!cancelled) setRuntime(snapshot);
      })
      .catch(() => {
        if (!cancelled) setRuntime(UNAVAILABLE_RUNTIME);
      });
    return () => { cancelled = true; };
  }, [connected, inspection]);

  const progress = useMemo(() => ({
    gatewayReady: connected,
    providerReady: runtime.provider === 'ready',
    mainAgentReady,
    conversationReady,
    channelReady: runtime.channel === 'ready',
  }), [connected, conversationReady, mainAgentReady, runtime]);
  const coreComplete = isOpenClawOnboardingComplete(progress);
  const completeCount = [progress.gatewayReady, progress.providerReady, progress.mainAgentReady, progress.conversationReady].filter(Boolean).length;
  const inspectionUnavailable = runtime.provider === 'unavailable' || runtime.channel === 'unavailable';

  const setExpanded = (expanded: boolean) => {
    setCollapsed(!expanded);
    setOpenClawOnboardingCollapsed(!expanded);
  };

  const steps = [
    {
      id: 'gateway', icon: connected ? Wifi : WifiOff,
      title: t('dashboard.onboardingGateway', 'Gateway'),
      detail: connected ? t('dashboard.onboardingGatewayReady', 'Online and responding') : t('dashboard.onboardingGatewayNeeded', 'Waiting for the local Gateway'),
      ready: connected, action: undefined,
    },
    {
      id: 'provider', icon: Sparkles,
      title: t('dashboard.onboardingProvider', 'Model provider'),
      detail: readinessDetail(
        runtime.provider,
        t('dashboard.onboardingProviderReady', 'A configured model is available'),
        t('dashboard.onboardingProviderNeeded', 'Connect a model to give OpenClaw reasoning'),
        t('dashboard.onboardingChecking', 'Checking status...'),
        t('dashboard.onboardingProviderUnavailable', 'Model configuration could not be verified'),
      ),
      ready: runtime.provider === 'ready', action: () => onNavigate('/config?tab=providers'),
    },
    {
      id: 'agent', icon: Bot,
      title: t('dashboard.onboardingAgent', 'Main agent'),
      detail: mainAgentReady ? t('dashboard.onboardingAgentReady', 'Ready to receive work') : t('dashboard.onboardingAgentNeeded', 'Review the agent configuration'),
      ready: mainAgentReady, action: () => onNavigate('/agents'),
    },
    {
      id: 'conversation', icon: MessageSquare,
      title: t('dashboard.onboardingConversation', 'First conversation'),
      detail: conversationReady ? t('dashboard.onboardingConversationReady', 'End-to-end path verified') : t('dashboard.onboardingConversationNeeded', 'Send a first instruction to verify the full path'),
      ready: conversationReady, action: () => onNavigate('/chat?agent=main&new=1'),
    },
    {
      id: 'channel', icon: Radio,
      title: t('dashboard.onboardingChannel', 'Channel'),
      detail: readinessDetail(
        runtime.channel,
        t('dashboard.onboardingChannelReady', 'A delivery channel is configured'),
        t('dashboard.onboardingChannelNeeded', 'Optional: connect an external channel'),
        t('dashboard.onboardingChecking', 'Checking status...'),
        t('dashboard.onboardingChannelUnavailable', 'Channel configuration could not be verified'),
      ),
      ready: runtime.channel === 'ready', action: () => onNavigate('/channels'), optional: true,
    },
  ];

  return (
    <GlassCard hover={false} delay={0.02} className="border-aegis-primary/25">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-aegis-primary/25 bg-aegis-primary/10 text-aegis-primary">
            <Network size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] font-semibold text-aegis-text">{t('dashboard.onboardingTitle', 'OpenClaw startup map')}</h2>
              <span className={coreComplete ? 'rounded-full bg-aegis-success/10 px-2 py-0.5 text-[10px] font-semibold text-aegis-success' : 'rounded-full bg-aegis-primary/10 px-2 py-0.5 text-[10px] font-semibold text-aegis-primary'}>
                {coreComplete ? t('dashboard.onboardingReady', 'Core ready') : t('dashboard.onboardingProgress', '{{count}} / 4 core steps', { count: completeCount })}
              </span>
            </div>
            <p className="mt-1 text-[12px] text-aegis-text-dim">
              {coreComplete
                ? t('dashboard.onboardingReadyHint', 'Your local OpenClaw path is ready. Extend it with agents and channels when needed.')
                : t('dashboard.onboardingHint', 'Follow the live runtime path from Gateway to a verified first conversation.')}
            </p>
          </div>
        </div>
        <button type="button" onClick={() => setExpanded(collapsed)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text" title={collapsed ? t('dashboard.onboardingExpand', 'Expand startup map') : t('dashboard.onboardingCollapse', 'Collapse startup map')}>
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {!collapsed && (
        <div className="mt-5 grid grid-cols-1 gap-2 lg:grid-cols-5">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div key={step.id} className="relative min-w-0 border border-aegis-border bg-aegis-surface px-3 py-3 lg:min-h-[132px]">
                {index < steps.length - 1 && <div className="absolute -right-2 top-1/2 z-10 hidden h-px w-4 bg-aegis-border lg:block" />}
                <div className="flex items-center justify-between gap-2">
                  <span className={step.ready ? 'flex h-7 w-7 items-center justify-center rounded-md bg-aegis-success/10 text-aegis-success' : 'flex h-7 w-7 items-center justify-center rounded-md bg-aegis-overlay/5 text-aegis-text-dim'}><Icon size={14} /></span>
                  {step.ready ? <Check size={14} className="text-aegis-success" /> : step.optional ? <span className="text-[10px] text-aegis-text-dim">{t('dashboard.onboardingOptional', 'Optional')}</span> : <Circle size={13} className="text-aegis-primary" />}
                </div>
                <div className="mt-3 text-[12px] font-semibold text-aegis-text">{step.title}</div>
                <div className="mt-1 min-h-[30px] text-[10.5px] leading-[15px] text-aegis-text-dim">{step.detail}</div>
                {step.action && !step.ready && <button type="button" onClick={step.action} className="mt-3 inline-flex items-center gap-1 text-[10.5px] font-semibold text-aegis-primary hover:underline">{t('dashboard.onboardingOpen', 'Open')}<ChevronRight size={12} /></button>}
              </div>
            );
          })}
        </div>
      )}
      {collapsed && <div className="mt-3 flex flex-wrap gap-2">{steps.map((step) => <span key={step.id} className={step.ready ? 'inline-flex items-center gap-1.5 rounded-md border border-aegis-success/25 bg-aegis-success/5 px-2 py-1 text-[10px] text-aegis-success' : 'inline-flex items-center gap-1.5 rounded-md border border-aegis-border px-2 py-1 text-[10px] text-aegis-text-dim'}>{step.ready ? <Check size={11} /> : <Circle size={10} />}{step.title}</span>)}</div>}
      {!collapsed && (coreComplete || inspectionUnavailable) && (
        <div className="mt-4 flex justify-end gap-3">
          {inspectionUnavailable && connected && <button type="button" onClick={() => setInspection((value) => value + 1)} className="inline-flex items-center gap-1.5 text-[11px] text-aegis-primary hover:underline"><RefreshCw size={12} />{t('dashboard.onboardingRetry', 'Retry checks')}</button>}
          {coreComplete && <button type="button" onClick={() => setExpanded(false)} className="inline-flex items-center gap-1.5 text-[11px] text-aegis-text-dim hover:text-aegis-text"><Settings2 size={12} />{t('dashboard.onboardingCollapse', 'Collapse startup map')}</button>}
        </div>
      )}
    </GlassCard>
  );
}
