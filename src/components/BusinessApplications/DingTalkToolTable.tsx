import clsx from 'clsx';
import { ChevronRight, Wrench } from 'lucide-react';
import { EmptyState } from '@/components/shared/EmptyState';
import { dingTalkDomainLabel, type DingTalkEffectiveTool } from '@/business-applications/dingtalkTools';

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
        title={loading ? '正在读取有效工具' : '没有可展示的钉钉工具'}
        description={loading ? '等待 OpenClaw 返回当前 Session 的 tools.effective。' : emptyMessage}
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full min-w-[660px] border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-aegis-surface">
          <tr className="h-8 border-b border-aegis-border text-[10.5px] font-medium text-aegis-text-dim">
            <th className="w-[35%] px-3 font-medium">工具</th>
            <th className="px-3 font-medium">业务域</th>
            <th className="px-3 font-medium">效果</th>
            <th className="px-3 font-medium">风险</th>
            <th className="px-3 font-medium">状态</th>
            <th className="w-8" aria-label="打开详情" />
          </tr>
        </thead>
        <tbody>
          {tools.map((tool) => {
            const selected = selectedId === tool.entry.id;
            const verified = tool.effect !== 'unknown' && Boolean(tool.entry.risk);
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
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(tool);
                    }}
                    className="block w-full truncate text-left font-medium text-aegis-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
                  >
                    {tool.entry.label}
                  </button>
                </td>
                <td className="px-3 text-aegis-text-dim">{dingTalkDomainLabel(tool.domain)}</td>
                <td className={clsx('px-3 font-medium', tool.effect === 'write' ? 'text-aegis-warning' : 'text-aegis-text-dim')}>
                  {effectLabel(tool.effect)}
                </td>
                <td className={clsx('px-3', tool.entry.risk === 'high' ? 'text-aegis-danger' : 'text-aegis-text-dim')}>
                  {riskLabel(tool.entry.risk)}
                </td>
                <td className="px-3">
                  <span className={verified ? 'text-aegis-success' : 'text-aegis-warning'}>
                    {tool.entry.deniedBySession ? 'Session 已拒绝' : verified ? '有效' : '契约不完整'}
                  </span>
                </td>
                <td className="pr-2 text-aegis-text-dim"><ChevronRight size={13} aria-hidden="true" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
