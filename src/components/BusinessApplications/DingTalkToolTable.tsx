import clsx from 'clsx';
import { ChevronRight, Wrench } from 'lucide-react';
import { EmptyState } from '@/components/shared/EmptyState';
import { dingTalkDomainLabel, type DingTalkDomain, type DingTalkEffectiveTool } from '@/business-applications/dingtalkTools';

function effectLabel(effect: DingTalkEffectiveTool['effect']): string {
  if (effect === 'read') return '读取';
  if (effect === 'write') return '写入';
  return '未验证';
}

function riskLabel(risk: DingTalkEffectiveTool['entry']['risk']): string {
  if (risk === 'low') return '低';
  if (risk === 'medium') return '中';
  if (risk === 'high') return '高';
  return '未验证';
}

export interface DingTalkToolTableGroup {
  readonly domain: DingTalkDomain;
  readonly label: string;
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
    label: dingTalkDomainLabel(domain),
    tools: groupedTools,
  }));
}

export function DingTalkToolTable({
  tools,
  selectedId,
  loading,
  emptyMessage,
  onSelect,
}: {
  tools: readonly DingTalkEffectiveTool[];
  selectedId: string | null;
  loading: boolean;
  emptyMessage: string;
  onSelect: (tool: DingTalkEffectiveTool) => void;
}) {
  if (tools.length === 0) {
    return (
      <EmptyState
        density="compact"
        iconStyle="bare"
        icon={<Wrench size={24} />}
        title={loading ? '正在读取插件操作目录' : '当前账号没有可展示的操作'}
        description={loading ? '等待 OpenClaw 与当前 DWS Profile 的核验结果。' : emptyMessage}
      />
    );
  }
  const groups = groupDingTalkToolsForTable(tools);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-aegis-border bg-aegis-surface/45 px-3 py-2 text-[9.5px] leading-4 text-aegis-text-dim">
        当前列表是 OpenClaw 向此 Session 暴露、并与已登录 DWS Profile 绑定的插件操作目录。账号业务权限由每次实际调用的钉钉结果确认。
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-aegis-surface">
            <tr className="h-8 border-b border-aegis-border text-[10.5px] font-medium text-aegis-text-dim">
              <th className="w-[46%] px-3 font-medium">操作</th>
              <th className="px-3 font-medium">业务域</th>
              <th className="px-3 font-medium">效果</th>
              <th className="px-3 font-medium">风险</th>
              <th className="w-8" aria-label="打开详情" />
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.domain} aria-label={`${group.label}工具`}>
              <tr className="h-7 border-b border-aegis-border bg-aegis-surface/65">
                <th colSpan={5} scope="rowgroup" className="px-3 text-[9.5px] font-semibold tracking-[0.08em] text-aegis-text-dim">
                  {group.label}<span className="ml-2 font-normal tabular-nums">{group.tools.length}</span>
                </th>
              </tr>
              {group.tools.map((tool) => {
                const selected = selectedId === tool.entry.id;
                return (
                  <tr
                    key={tool.entry.id}
                    aria-selected={selected}
                    onClick={() => onSelect(tool)}
                    className={clsx(
                      'h-11 cursor-pointer border-b border-aegis-border/70 text-[11px] transition-colors',
                      selected ? 'bg-aegis-primary/[0.08]' : 'hover:bg-aegis-hover/45',
                    )}
                  >
                    <td className="max-w-0 px-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelect(tool);
                          }}
                          className="block min-w-0 flex-1 truncate text-left font-medium text-aegis-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
                        >
                          {tool.entry.label}
                        </button>
                        {tool.entry.deniedBySession && (
                          <span className="shrink-0 rounded border border-aegis-danger/25 bg-aegis-danger/10 px-1.5 py-0.5 text-[9px] text-aegis-danger">
                            Session 已拒绝
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 text-aegis-text-dim">{dingTalkDomainLabel(tool.domain)}</td>
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
    </div>
  );
}
