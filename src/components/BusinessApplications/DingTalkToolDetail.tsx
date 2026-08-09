import { Braces, ChevronRight, PanelRightClose, Play, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button, IconButton } from '@/components/shared/button/Button';
import {
  DINGTALK_RUNTIME_STATUS_TOOL,
  dingTalkDomainLabel,
  type DingTalkEffectiveTool,
  type DingTalkToolSchemaProjection,
} from '@/business-applications/dingtalkTools';
import { PaneResizeHandle } from './PaneResizeHandle';

function prettyJson(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function DingTalkToolDetail({
  tool,
  width,
  collapsed,
  profile,
  argumentsJson,
  schema,
  schemaLoading,
  schemaError,
  invocationOutput,
  invocationError,
  invoking,
  disabledReason,
  onWidthChange,
  onCollapsedChange,
  onProfileChange,
  onArgumentsChange,
  onLoadSchema,
  onInvoke,
}: {
  tool: DingTalkEffectiveTool | null;
  width: number;
  collapsed: boolean;
  profile: string;
  argumentsJson: string;
  schema: DingTalkToolSchemaProjection | null;
  schemaLoading: boolean;
  schemaError: string | null;
  invocationOutput: unknown;
  invocationError: string | null;
  invoking: boolean;
  disabledReason: string | null;
  onWidthChange: (value: number) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onProfileChange: (value: string) => void;
  onArgumentsChange: (value: string) => void;
  onLoadSchema: () => void;
  onInvoke: () => void;
}) {
  if (collapsed) {
    return (
      <aside className="flex min-h-0 flex-col items-center border-l border-aegis-border bg-aegis-surface/55 py-2">
        <IconButton aria-label="展开工具详情" title="展开工具详情" onClick={() => onCollapsedChange(false)}>
          <ChevronRight size={15} className="rotate-180" />
        </IconButton>
        <span className="mt-3 text-[10px] tracking-[0.18em] text-aegis-text-dim" style={{ writingMode: 'vertical-rl' }}>工具详情</span>
      </aside>
    );
  }

  const runtimeTool = tool?.entry.id === DINGTALK_RUNTIME_STATUS_TOOL;
  return (
    <aside className="relative flex min-h-0 min-w-0 flex-col border-l border-aegis-border bg-aegis-surface/55">
      <PaneResizeHandle side="right" value={width} min={300} max={520} label="调整工具详情宽度" onChange={onWidthChange} />
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-aegis-border px-3">
        <span className="text-[11.5px] font-semibold text-aegis-text-secondary">工具详情</span>
        <IconButton aria-label="收起工具详情" title="收起工具详情" onClick={() => onCollapsedChange(true)}>
          <PanelRightClose size={15} />
        </IconButton>
      </header>
      {!tool ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-[11px] text-aegis-text-dim">选择一个有效工具查看契约和执行参数。</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-[13px] font-semibold text-aegis-text">{tool.entry.label}</h2>
              <p className="mt-1 text-[10.5px] leading-4 text-aegis-text-dim">{tool.entry.description}</p>
            </div>
            <span className="shrink-0 rounded border border-aegis-border px-1.5 py-0.5 text-[9.5px] text-aegis-text-dim">
              {dingTalkDomainLabel(tool.domain)}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-[76px_minmax(0,1fr)] gap-y-1.5 border-y border-aegis-border py-2 text-[10px]">
            <dt className="text-aegis-text-dim">业务域</dt>
            <dd className="text-aegis-text-secondary">{dingTalkDomainLabel(tool.domain)}</dd>
            <dt className="text-aegis-text-dim">效果</dt>
            <dd className="text-aegis-text-secondary">{tool.effect === 'read' ? '读取' : tool.effect === 'write' ? '写入' : '未验证'}</dd>
            <dt className="text-aegis-text-dim">风险</dt>
            <dd className="text-aegis-text-secondary">{tool.entry.risk ?? '未验证'}</dd>
            <dt className="text-aegis-text-dim">Session</dt>
            <dd className="text-aegis-text-secondary">{tool.entry.deniedBySession ? '已拒绝' : '有效'}</dd>
          </dl>

          {!runtimeTool && (
            <>
              <label className="mt-3 block text-[10.5px] font-medium text-aegis-text-secondary" htmlFor="dingtalk-profile">租户身份</label>
              <input
                id="dingtalk-profile"
                value={profile}
                onChange={(event) => onProfileChange(event.target.value)}
                placeholder="corpId:userId"
                autoComplete="off"
                spellCheck={false}
                className="mt-1 h-8 w-full rounded-md border border-aegis-border bg-aegis-bg px-2 font-mono text-[10.5px] text-aegis-text outline-none placeholder:text-aegis-text-dim focus:border-aegis-primary/60 focus:ring-1 focus:ring-aegis-primary/25"
              />

              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-[10.5px] font-medium text-aegis-text-secondary">当前 DWS 参数</span>
                <Button size="xs" variant="ghost" loading={schemaLoading} leadingIcon={<RefreshCw size={11} />} onClick={onLoadSchema}>重新读取</Button>
              </div>
              {schemaError && <p className="mt-1.5 text-[10px] leading-4 text-aegis-danger">{schemaError}</p>}
              {schema && (
                <div className="mt-1.5 overflow-hidden rounded-md border border-aegis-border">
                  {schema.parameters.length === 0 ? (
                    <div className="px-2 py-2 text-[10px] text-aegis-text-dim">此工具没有业务参数。</div>
                  ) : schema.parameters.map((parameter) => (
                    <div key={parameter.name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 border-b border-aegis-border/60 px-2 py-1.5 text-[10px] last:border-b-0">
                      <code className="truncate text-aegis-text-secondary">{parameter.property ?? parameter.name}</code>
                      <span className="text-aegis-text-dim">{parameter.type}</span>
                      <span className={parameter.required ? 'text-aegis-warning' : 'text-aegis-text-dim'}>{parameter.required ? '必填' : '可选'}</span>
                    </div>
                  ))}
                </div>
              )}

              <details className="mt-3 border border-aegis-border bg-aegis-surface/35">
                <summary className="cursor-pointer px-2.5 py-2 text-[10.5px] font-medium text-aegis-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-aegis-primary/60">高级参数与运行时契约</summary>
                <div className="border-t border-aegis-border px-2.5 py-2.5">
                  <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-y-1.5 text-[9.5px]">
                    <dt className="text-aegis-text-dim">工具 ID</dt>
                    <dd className="truncate font-mono text-aegis-text-secondary" title={tool.entry.id}>{tool.entry.id}</dd>
                    <dt className="text-aegis-text-dim">DWS 路径</dt>
                    <dd className="truncate font-mono text-aegis-text-secondary" title={schema?.canonicalPath}>{schema?.canonicalPath ?? '待读取'}</dd>
                    <dt className="text-aegis-text-dim">Schema 摘要</dt>
                    <dd className="truncate font-mono text-aegis-text-secondary" title={schema?.schemaDigest}>{schema?.schemaDigest ?? '待读取'}</dd>
                  </dl>
                  <label className="mt-2.5 block text-[10px] font-medium text-aegis-text-secondary" htmlFor="dingtalk-arguments">参数 JSON</label>
                  <textarea
                    id="dingtalk-arguments"
                    value={argumentsJson}
                    onChange={(event) => onArgumentsChange(event.target.value)}
                    spellCheck={false}
                    className="mt-1 min-h-[112px] w-full resize-y rounded-md border border-aegis-border bg-aegis-bg p-2 font-mono text-[10.5px] leading-5 text-aegis-text outline-none focus:border-aegis-primary/60 focus:ring-1 focus:ring-aegis-primary/25"
                  />
                </div>
              </details>
            </>
          )}

          {tool.effect === 'write' && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-aegis-warning/25 bg-aegis-warning/[0.06] px-2.5 py-2 text-[10px] leading-4 text-aegis-warning">
              <ShieldAlert size={13} className="mt-0.5 shrink-0" />
              写操作先经过本地确认，再由 OpenClaw 插件审批；未知结果不会自动重试。
            </div>
          )}
          {disabledReason && <p className="mt-2 text-[10px] leading-4 text-aegis-warning">{disabledReason}</p>}
          <Button
            className="mt-3"
            fullWidth
            size="sm"
            variant="solid"
            tone={tool.effect === 'write' ? 'warning' : 'primary'}
            loading={invoking}
            disabled={Boolean(disabledReason)}
            leadingIcon={runtimeTool ? <Braces size={13} /> : <Play size={13} />}
            onClick={onInvoke}
          >
            {runtimeTool ? '检查运行时' : tool.effect === 'write' ? '确认并执行' : '执行读取'}
          </Button>

          {invocationError && <p className="mt-3 text-[10px] leading-4 text-aegis-danger">{invocationError}</p>}
          {invocationOutput !== undefined && (
            <div className="mt-3">
              <div className="text-[10.5px] font-medium text-aegis-text-secondary">本次结果</div>
              <pre className="mt-1 max-h-[260px] overflow-auto rounded-md border border-aegis-border bg-aegis-bg p-2 whitespace-pre-wrap break-words font-mono text-[9.5px] leading-4 text-aegis-text-dim">{prettyJson(invocationOutput)}</pre>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
