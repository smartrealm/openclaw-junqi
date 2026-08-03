import { Bot, ChevronRight, FileSearch, KeyRound, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BusinessCapabilityDescriptor, BusinessIntegrationDescriptor } from '@/business-applications/types';
import { BusinessApplicationIcon } from './BusinessApplicationIcon';
import { CapabilityAvailability, CapabilityEffectBadge, IntegrationStatus } from './IntegrationStatus';
import { ActiveTabIndicator, AnimatedTabPanel } from '@/components/shared/TabMotion';

export type BusinessApplicationsView = 'overview' | 'capabilities' | 'operations';

const VIEW_IDS: readonly BusinessApplicationsView[] = ['overview', 'capabilities', 'operations'];

function DetailTabs({ activeView, onChange }: {
  activeView: BusinessApplicationsView;
  onChange: (view: BusinessApplicationsView) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex border-b border-aegis-border px-5" role="tablist" aria-label={t('businessApplications.detailTabsAriaLabel', '业务应用视图')}>
      {VIEW_IDS.map((view) => (
        <button
          key={view}
          type="button"
          role="tab"
          aria-selected={activeView === view}
          onClick={() => onChange(view)}
          className={`relative h-10 px-3 text-[11.5px] font-medium transition-[color,transform] duration-200 active:scale-[0.98] ${activeView === view ? 'text-aegis-primary' : 'text-aegis-text-dim hover:text-aegis-text-secondary'}`}
        >
          {t(`businessApplications.tabs.${view}`)}
          {activeView === view && (
            <ActiveTabIndicator
              layoutId="business-application-active-tab"
              className="inset-x-2 bottom-0 h-0.5 bg-aegis-primary"
            />
          )}
        </button>
      ))}
    </div>
  );
}

function PrerequisiteRow({ integration }: { integration: BusinessIntegrationDescriptor }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3 border-b border-aegis-border/70 py-3.5 last:border-b-0">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-aegis-overlay/[0.04] text-aegis-text-dim">
        <FileSearch size={14} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] font-medium text-aegis-text-secondary">{t('businessApplications.prerequisites')}</div>
        <p className="mt-1 text-[11px] leading-5 text-aegis-text-dim">{t(integration.prerequisitesKey)}</p>
      </div>
      <button
        type="button"
        title={t('businessApplications.probeUnavailableHint', '运行时探测尚未接入；不会在展示页面伪造检测结果。')}
        className="shrink-0 text-[11px] font-medium text-aegis-text-dim"
        disabled
      >
        {t('businessApplications.probeRuntime', '检查运行时')}
      </button>
    </div>
  );
}

function CapabilityRow({ capability, onPlan }: {
  capability: BusinessCapabilityDescriptor;
  onPlan: (capability: BusinessCapabilityDescriptor) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-aegis-border/70 py-3.5 last:border-b-0">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[12px] font-medium text-aegis-text-secondary">{t(capability.titleKey)}</span>
          <CapabilityEffectBadge effect={capability.effect} />
        </div>
        <p className="mt-1 text-[11px] leading-5 text-aegis-text-dim">{t(capability.descriptionKey)}</p>
      </div>
      <div className="flex items-center gap-3 self-center">
        <CapabilityAvailability availability={capability.availability} />
        <button
          type="button"
          onClick={() => onPlan(capability)}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10.5px] font-medium text-aegis-primary transition-colors hover:bg-aegis-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
        >
          {t('businessApplications.planWithAi', '交给 AI 规划')}
          <ChevronRight size={12} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function Overview({ integration, onSelectCapabilities }: {
  integration: BusinessIntegrationDescriptor;
  onSelectCapabilities: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="px-5 py-1">
      <div className="border-b border-aegis-border/70 py-3.5">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-8 gap-y-3">
          <div>
            <div className="text-[10.5px] text-aegis-text-dim">{t('businessApplications.runtime')}</div>
            <div className="mt-1 text-[12px] font-medium text-aegis-text-secondary">{t(`businessApplications.runtimeKinds.${integration.runtimeKind}`)}</div>
          </div>
          <div>
            <div className="text-[10.5px] text-aegis-text-dim">{t('businessApplications.identity')}</div>
            <div className="mt-1 text-[12px] font-medium text-aegis-text-dim">{t('businessApplications.identityUnverified', '尚未选择已验证身份')}</div>
          </div>
          <div>
            <div className="text-[10.5px] text-aegis-text-dim">{t('businessApplications.authorization')}</div>
            <div className="mt-1 text-[12px] font-medium text-aegis-text-dim">{t('businessApplications.authorizationNotStarted', '尚未开始授权')}</div>
          </div>
          <div>
            <div className="text-[10.5px] text-aegis-text-dim">{t('businessApplications.capabilitySnapshot')}</div>
            <div className="mt-1 text-[12px] font-medium text-aegis-text-dim">{t('businessApplications.snapshotNotAvailable', '等待运行时验证')}</div>
          </div>
        </div>
      </div>
      <PrerequisiteRow integration={integration} />
      <div className="flex items-center justify-between gap-4 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-aegis-primary/10 text-aegis-primary"><ShieldCheck size={14} aria-hidden="true" /></span>
          <div className="min-w-0">
            <div className="text-[11.5px] font-medium text-aegis-text-secondary">{t('businessApplications.safeExecutionTitle', '统一确认与追溯')}</div>
            <p className="mt-0.5 text-[11px] leading-4 text-aegis-text-dim">{t('businessApplications.safeExecutionDescription', '任何写操作都会先生成计划，确认后才会由受控适配器执行。')}</p>
          </div>
        </div>
        <button type="button" onClick={onSelectCapabilities} className="shrink-0 text-[11px] font-medium text-aegis-primary hover:underline">
          {t('businessApplications.viewCapabilities', '查看能力')}
        </button>
      </div>
    </div>
  );
}

function Capabilities({ integration, onPlan }: {
  integration: BusinessIntegrationDescriptor;
  onPlan: (capability: BusinessCapabilityDescriptor) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="px-5 py-1">
      <div className="flex items-center justify-between border-b border-aegis-border/70 py-3">
        <div>
          <div className="text-[11.5px] font-medium text-aegis-text-secondary">{t('businessApplications.capabilitiesTitle', '能力目录')}</div>
          <p className="mt-1 text-[10.5px] text-aegis-text-dim">{t('businessApplications.capabilitiesHint', '可用性来自运行时和授权快照；当前仅展示接入前提。')}</p>
        </div>
        <span className="text-[10.5px] tabular-nums text-aegis-text-dim">{integration.capabilities.length}</span>
      </div>
      {integration.capabilities.map((capability) => <CapabilityRow key={capability.id} capability={capability} onPlan={onPlan} />)}
    </div>
  );
}

function Operations() {
  const { t } = useTranslation();
  return (
    <div className="px-5 py-8">
      <div className="max-w-[420px]">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-aegis-overlay/[0.05] text-aegis-text-dim"><KeyRound size={16} aria-hidden="true" /></div>
        <h2 className="mt-3 text-[13px] font-semibold text-aegis-text-secondary">{t('businessApplications.operationsUnavailableTitle', '暂无可执行操作')}</h2>
        <p className="mt-1.5 text-[11px] leading-5 text-aegis-text-dim">{t('businessApplications.operationsUnavailableDescription', '选择已验证身份并完成能力授权后，操作草稿会在这里出现。AI 提议与手动操作使用同一份确认和记录。')}</p>
      </div>
    </div>
  );
}

export function ApplicationDetail({
  integration,
  activeView,
  onViewChange,
  onPlan,
}: {
  integration: BusinessIntegrationDescriptor;
  activeView: BusinessApplicationsView;
  onViewChange: (view: BusinessApplicationsView) => void;
  onPlan: (capability: BusinessCapabilityDescriptor) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex min-w-0 flex-col border border-aegis-border bg-aegis-surface/35">
      <header className="flex min-h-[76px] items-center justify-between gap-5 border-b border-aegis-border px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-aegis-border bg-aegis-overlay/[0.04] text-aegis-primary">
            <BusinessApplicationIcon icon={integration.icon} size={19} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold text-aegis-text">{t(integration.nameKey)}</h1>
            <p className="mt-1 truncate text-[11px] text-aegis-text-dim">{t(integration.descriptionKey)}</p>
          </div>
        </div>
        <IntegrationStatus state={integration.state} />
      </header>
      <DetailTabs activeView={activeView} onChange={onViewChange} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AnimatedTabPanel transitionKey={activeView}>
          {activeView === 'overview' && <Overview integration={integration} onSelectCapabilities={() => onViewChange('capabilities')} />}
          {activeView === 'capabilities' && <Capabilities integration={integration} onPlan={onPlan} />}
          {activeView === 'operations' && <Operations />}
        </AnimatedTabPanel>
      </div>
      <footer className="flex items-center gap-2 border-t border-aegis-border px-5 py-2.5 text-[10.5px] text-aegis-text-dim">
        <Bot size={13} aria-hidden="true" />
        {t('businessApplications.aiBoundary', 'AI 可读取脱敏能力状态并生成操作计划；执行必须经过同一确认与审计边界。')}
      </footer>
    </section>
  );
}
