import clsx from 'clsx';
import { ChevronRight, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/shared/EmptyState';
import { type DingTalkDomain, type DingTalkEffectiveTool } from '@/business-applications/dingtalkTools';

export interface DingTalkToolTableGroup {
  readonly domain: DingTalkDomain;
  readonly tools: readonly DingTalkEffectiveTool[];
}

export function groupDingTalkToolsForTable(tools: readonly DingTalkEffectiveTool[]): DingTalkToolTableGroup[] {
  const groups = new Map<DingTalkDomain, DingTalkEffectiveTool[]>();
  for (const tool of tools) {
    const group = groups.get(tool.domain) ?? [];
    group.push(tool);
    groups.set(tool.domain, group);
  }
  return [...groups.entries()].map(([domain, groupedTools]) => ({
    domain,
    tools: groupedTools,
  }));
}

export function DingTalkToolTable({
  tools,
  selectedId,
  loading,
  emptyTitle,
  emptyMessage,
  onSelect,
}: {
  tools: readonly DingTalkEffectiveTool[];
  selectedId: string | null;
  loading: boolean;
  emptyTitle: string;
  emptyMessage: string;
  onSelect: (tool: DingTalkEffectiveTool) => void;
}) {
  const { t } = useTranslation();
  if (tools.length === 0) {
    return (
      <EmptyState
        density="compact"
        iconStyle="bare"
        icon={<Wrench size={24} />}
        title={loading ? t('businessApplications.workbench.catalog.loadingTitle') : emptyTitle}
        description={loading ? t('businessApplications.workbench.catalog.loadingDescription') : emptyMessage}
      />
    );
  }
  const groups = groupDingTalkToolsForTable(tools);
  const domainLabel = (domain: DingTalkDomain) => t(`businessApplications.workbench.domain.${domain}`);
  const effectLabel = (effect: DingTalkEffectiveTool['effect']) => (
    effect === 'read'
      ? t('businessApplications.workbench.effect.read')
      : effect === 'write'
        ? t('businessApplications.workbench.effect.write')
        : t('businessApplications.workbench.unverified')
  );
  const riskLabel = (risk: DingTalkEffectiveTool['entry']['risk']) => (
    risk ? t(`businessApplications.workbench.risk.${risk}`) : t('businessApplications.workbench.unverified')
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[440px] border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-aegis-surface">
            <tr className="h-9 border-b border-aegis-border text-[11px] font-medium text-aegis-text-dim">
              <th className="w-[64%] px-4 font-medium">{t('businessApplications.workbench.table.operation')}</th>
              <th className="px-3 font-medium">{t('businessApplications.workbench.effectLabel')}</th>
              <th className="px-3 font-medium">{t('businessApplications.workbench.riskLabel')}</th>
              <th className="w-9" aria-label={t('businessApplications.workbench.table.openDetail')} />
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.domain} aria-label={t('businessApplications.workbench.table.groupAriaLabel', { label: domainLabel(group.domain) })}>
              <tr className="h-8 border-b border-aegis-border bg-aegis-surface/65">
                <th colSpan={4} scope="rowgroup" className="px-4 text-[10px] font-semibold tracking-[0.06em] text-aegis-text-dim">
                  {domainLabel(group.domain)}<span className="ml-2 font-normal tabular-nums">{group.tools.length}</span>
                </th>
              </tr>
              {group.tools.map((tool) => {
                const selected = selectedId === tool.entry.id;
                return (
                  <tr
                    key={tool.entry.id}
                    aria-selected={selected}
                    className={clsx(
                      'h-14 border-b border-aegis-border/70 text-[11px] transition-colors',
                      selected ? 'bg-aegis-primary/[0.08]' : 'hover:bg-aegis-hover/35',
                    )}
                  >
                    <td className="max-w-0 p-0">
                      <button
                        type="button"
                        aria-current={selected ? 'true' : undefined}
                        onClick={() => onSelect(tool)}
                        className="flex min-h-14 w-full min-w-0 items-center gap-2 px-4 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-aegis-primary/50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium leading-4 text-aegis-text-secondary">{tool.entry.label}</span>
                          <span className="mt-0.5 block truncate text-[10.5px] leading-4 text-aegis-text-dim">{tool.entry.description}</span>
                        </span>
                        {tool.entry.deniedBySession && (
                          <span className="shrink-0 rounded-md border border-aegis-danger/25 bg-aegis-danger/10 px-1.5 py-0.5 text-[10px] text-aegis-danger">
                            {t('businessApplications.workbench.sessionDenied')}
                          </span>
                        )}
                      </button>
                    </td>
                    <td className={clsx('px-3 font-medium', tool.effect === 'write' ? 'text-aegis-warning' : 'text-aegis-text-dim')}>
                      {effectLabel(tool.effect)}
                    </td>
                    <td className={clsx('px-3', tool.entry.risk === 'high' ? 'text-aegis-danger' : 'text-aegis-text-dim')}>
                      {riskLabel(tool.entry.risk)}
                    </td>
                    <td className="pr-2 text-aegis-text-dim"><ChevronRight size={13} aria-hidden="true" /></td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      <p className="shrink-0 border-t border-aegis-border bg-aegis-surface/45 px-4 py-2 text-[10px] leading-4 text-aegis-text-dim">
        {t('businessApplications.workbench.table.catalogBoundary')}
      </p>
    </div>
  );
}
