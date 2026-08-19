import { Bot, CircleSlash, Crown, ShieldCheck, UsersRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { CollaborationCapabilityAgent } from '@/types/collaboration';
import { AgentOfficeCharacter, AgentOfficeFurniture } from '@/components/Collaboration/AgentOfficeArtwork';
import { buildConfiguredOfficeRoster } from './agentHubConfiguredOfficeRoster';

export function AgentHubConfiguredOffice({
  agents,
}: {
  agents: readonly CollaborationCapabilityAgent[];
}) {
  const { t } = useTranslation();
  const roster = buildConfiguredOfficeRoster(agents);

  if (roster.length === 0) return null;

  const coordinator = roster.filter((agent) => agent.coordinator);
  const allowed = roster.filter((agent) => !agent.coordinator && agent.allowed);
  const configuredOnly = roster.filter((agent) => !agent.coordinator && !agent.allowed);

  const renderDesk = (agent: (typeof roster)[number]) => {
    const configurationLabel = agent.coordinator
      ? t('agentHub.office.configuredCoordinator', '协调智能体')
      : agent.allowed
        ? t('agentHub.office.configuredAllowed', '允许参与')
        : t('agentHub.office.configuredOnly', '仅已配置');
    const seatState = agent.coordinator
      ? 'coordinator'
      : agent.allowed
        ? 'authorized'
        : 'configured-only';
    return (
      <article
        key={agent.id}
        data-agent-hub-configured-agent-id={agent.id}
        data-agent-hub-configured-seat-state={seatState}
        aria-label={`${agent.displayName}，${configurationLabel}`}
        className="relative flex min-w-0 items-center gap-2.5 px-2 py-2.5"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div className={cn('relative grid size-12 shrink-0 place-items-center rounded-md border bg-aegis-surface-solid', agent.allowed || agent.coordinator ? 'border-aegis-primary/25 text-aegis-primary' : 'border-aegis-border text-aegis-text-muted')}>
            <AgentOfficeCharacter
              agentId={agent.id}
              state="configured"
              coordinator={agent.coordinator}
              className="h-11 w-10"
            />
            <span className="absolute -bottom-1 -end-1 grid size-4 place-items-center rounded-sm border border-aegis-border bg-aegis-surface-solid text-aegis-text-muted">
              {agent.coordinator ? <Crown size={9} aria-hidden /> : agent.allowed ? <ShieldCheck size={9} aria-hidden /> : <CircleSlash size={9} aria-hidden />}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <h5 className="truncate text-xs font-semibold text-aegis-text" title={agent.displayName}>{agent.displayName}</h5>
            <p className={cn('mt-0.5 truncate text-[10px] font-medium', agent.allowed || agent.coordinator ? 'text-aegis-primary' : 'text-aegis-text-dim')}>
              {configurationLabel}
            </p>
          </div>
          <p className="max-w-[14rem] truncate text-[10px] text-aegis-text-muted" title={agent.description ?? agent.runtimeType ?? undefined}>
            {agent.description ?? agent.runtimeType ?? t('agentHub.office.configuredNoDescription', '未提供角色说明')}
          </p>
        </div>
      </article>
    );
  };

  return (
    <section className="w-full text-left" aria-labelledby="agent-hub-configured-office-title" data-agent-hub-configured-office-layout="spatial">
      <div className="mb-3 flex min-w-0 items-start gap-2 px-1">
        <div className="grid size-7 shrink-0 place-items-center rounded-lg border border-aegis-primary/25 bg-aegis-primary/[0.08] text-aegis-primary">
          <Bot size={14} aria-hidden />
        </div>
        <div className="min-w-0">
          <h4 id="agent-hub-configured-office-title" className="text-xs font-semibold text-aegis-text-secondary">
            {t('agentHub.office.configuredRosterTitle', '配置工位')}
          </h4>
          <p className="mt-0.5 text-[11px] leading-4 text-aegis-text-muted">
            {t('agentHub.office.configuredRosterDescription', '配置身份、协作许可和当前运行工位分别展示；这里不表示在线或执行状态。')}
          </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(13rem,0.85fr)_minmax(17rem,1.35fr)_minmax(13rem,0.85fr)]">
        <section className="relative overflow-hidden rounded-lg border border-aegis-primary/20 bg-aegis-primary/[0.035]" aria-labelledby="agent-hub-coordination-zone">
          <AgentOfficeFurniture kind="coordination" className="pointer-events-none absolute right-2 top-2 h-14 w-24 text-aegis-primary opacity-25" />
          <div className="px-3 py-3">
          <header className="flex items-center gap-1.5 text-[10.5px] font-semibold text-aegis-text-secondary">
            <Crown size={13} className="text-aegis-primary" aria-hidden />
            <h5 id="agent-hub-coordination-zone">{t('agentHub.office.configuredCoordinatorZone', '协调席位')}</h5>
          </header>
          <p className="mt-1 text-[9.5px] leading-4 text-aegis-text-dim">{t('agentHub.office.configuredCoordinatorZoneDescription', '仅表示配置中的协调角色。')}</p>
          </div>
          <div className="border-t border-aegis-primary/15">{coordinator.length > 0 ? coordinator.map(renderDesk) : <span className="block px-3 py-3 text-[10px] text-aegis-text-dim">{t('agentHub.office.configuredNoCoordinator', '未配置协调智能体')}</span>}</div>
        </section>
        <section className="relative overflow-hidden rounded-lg border border-aegis-border bg-aegis-surface" aria-labelledby="agent-hub-work-zone">
          <AgentOfficeFurniture kind="waiting" className="pointer-events-none absolute right-2 top-2 h-14 w-24 text-aegis-text-muted opacity-30" />
          <div className="px-3 py-3">
          <header className="flex items-center gap-1.5 text-[10.5px] font-semibold text-aegis-text-secondary">
            <UsersRound size={13} className="text-aegis-text-muted" aria-hidden />
            <h5 id="agent-hub-work-zone">{t('agentHub.office.configuredWorkZone', '已获协作许可')}</h5>
          </header>
          <p className="mt-1 text-[9.5px] leading-4 text-aegis-text-dim">{t('agentHub.office.configuredWorkZoneDescription', '这些 Agent 已通过当前协作插件许可；仍不表示已有运行分派。')}</p>
          </div>
          <div className="divide-y divide-aegis-border border-t border-aegis-border">
            {allowed.length > 0 && allowed.map(renderDesk)}
            {allowed.length === 0 && <span className="block px-3 py-3 text-[10px] text-aegis-text-dim">{t('agentHub.office.configuredNoAuthorizedWorkers', '尚无已获协作许可的 Agent')}</span>}
          </div>
        </section>
        <section className="relative overflow-hidden rounded-lg border border-dashed border-aegis-border bg-[rgb(var(--aegis-overlay)/0.018)]" aria-labelledby="agent-hub-configured-only-zone">
          <AgentOfficeFurniture kind="waiting" className="pointer-events-none absolute right-2 top-2 h-14 w-24 text-aegis-text-muted opacity-25" />
          <div className="px-3 py-3">
            <header className="flex items-center gap-1.5 text-[10.5px] font-semibold text-aegis-text-secondary">
              <CircleSlash size={13} className="text-aegis-text-muted" aria-hidden />
              <h5 id="agent-hub-configured-only-zone">{t('agentHub.office.configuredOnlyZone', '已配置，未纳入协作许可')}</h5>
            </header>
            <p className="mt-1 text-[9.5px] leading-4 text-aegis-text-dim">{t('agentHub.office.configuredOnlyZoneDescription', '这些是 OpenClaw 已配置 Agent；当前协作插件没有将它们列为可参与成员。')}</p>
          </div>
          <div className="divide-y divide-aegis-border border-t border-aegis-border">
            {configuredOnly.length > 0 && configuredOnly.map(renderDesk)}
            {configuredOnly.length === 0 && <span className="block px-3 py-3 text-[10px] text-aegis-text-dim">{t('agentHub.office.configuredNoConfiguredOnly', '所有配置 Agent 均已纳入当前协作许可')}</span>}
          </div>
        </section>
      </div>
    </section>
  );
}
