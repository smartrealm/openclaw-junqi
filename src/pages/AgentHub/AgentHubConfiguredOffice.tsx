import { Bot, Crown, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { CollaborationCapabilityAgent } from '@/services/collaboration/types';
import { buildConfiguredOfficeRoster } from './agentHubConfiguredOfficeRoster';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const value = parts.length > 1
    ? `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}`
    : name.trim().slice(0, 2);
  return value.toLocaleUpperCase();
}

export function AgentHubConfiguredOffice({
  agents,
}: {
  agents: readonly CollaborationCapabilityAgent[];
}) {
  const { t } = useTranslation();
  const roster = buildConfiguredOfficeRoster(agents);

  if (roster.length === 0) return null;

  return (
    <div className="w-full rounded-xl border border-aegis-border bg-aegis-bg p-3 text-left">
      <div className="mb-3 flex min-w-0 items-start gap-2">
        <div className="grid size-7 shrink-0 place-items-center rounded-lg border border-aegis-primary/25 bg-aegis-primary/[0.08] text-aegis-primary">
          <Bot size={14} aria-hidden />
        </div>
        <div className="min-w-0">
          <h4 className="text-xs font-semibold text-aegis-text-secondary">
            {t('agentHub.office.configuredRosterTitle', '已配置智能体')}
          </h4>
          <p className="mt-0.5 text-[11px] leading-4 text-aegis-text-muted">
            {t('agentHub.office.configuredRosterDescription', '展示配置中的员工席位，不代表当前运行参与、在线或执行状态。')}
          </p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {roster.map((agent) => {
          const configurationLabel = agent.coordinator
            ? t('agentHub.office.configuredCoordinator', '协调智能体')
            : agent.allowed
              ? t('agentHub.office.configuredAllowed', '允许参与')
              : t('agentHub.office.configuredUnavailable', '未允许参与');
          return (
            <article
              key={agent.id}
              data-agent-hub-configured-agent-id={agent.id}
              className="group min-w-0 rounded-lg border border-aegis-border bg-aegis-surface-solid px-3 py-2.5 transition-[transform,border-color,background-color] duration-[var(--aegis-duration-normal)] ease-[var(--aegis-ease-standard)] hover:-translate-y-px hover:border-aegis-border-hover hover:bg-aegis-elevated-solid motion-reduce:transform-none motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="relative grid size-10 shrink-0 place-items-center rounded-full border border-aegis-primary/25 bg-aegis-primary/[0.08] font-mono text-[10px] font-semibold text-aegis-primary">
                  <span>{initials(agent.displayName)}</span>
                  <span className="absolute -bottom-1 -end-1 grid size-4 place-items-center rounded-full border border-aegis-border bg-aegis-surface-solid text-aegis-text-muted">
                    {agent.coordinator ? <Crown size={9} aria-hidden /> : <ShieldCheck size={9} aria-hidden />}
                  </span>
                </div>
                <div className="min-w-0">
                  <h5 className="truncate text-xs font-semibold text-aegis-text" title={agent.displayName}>{agent.displayName}</h5>
                  <p className={cn('mt-0.5 truncate text-[10px] font-medium', agent.allowed ? 'text-aegis-primary' : 'text-aegis-text-dim')}>
                    {configurationLabel}
                  </p>
                </div>
              </div>
              <p className="mt-2 line-clamp-2 min-h-8 text-[10px] leading-4 text-aegis-text-muted">
                {agent.description ?? agent.runtimeType ?? t('agentHub.office.configuredNoDescription', '未提供角色说明')}
              </p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
