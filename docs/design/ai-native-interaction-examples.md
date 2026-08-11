# AI 原生交互示例代码归档

更新时间：2026-08-11

## 用途与边界

本文件归档用户提供的 React 示例的组件结构和关键实现片段，便于后续设计与实现时查阅。它们是交互参考，不是 JunQi 的生产代码，也不代表 OpenClaw 已支持其中演示的数据、命令、审批、模型、语音、任务或来源能力。

完整的数据边界和落地限制见 [AI 原生交互参考与 JunQi 映射](ai-native-interaction-reference.md)。示例中的固定延时、演示文本、静态数组和本地 `useState` 只能保留在文档参考中；接入 JunQi 前必须改为官方事件和实际契约。

## LoadingState

像素栅格与经过时间用于长耗时状态。生产实现只能从真实操作开始时间计算经过时间。

```tsx
const chevron = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3);
  const column = index % 3;
  return (column + Math.abs(row - 1)) * 90;
});

function useElapsed() {
  const [deciseconds, setDeciseconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setDeciseconds((value) => value + 1), 100);
    return () => clearInterval(timer);
  }, []);
  return `${(deciseconds / 10).toFixed(1)}s`;
}
```

## ThinkingState

折叠的步骤轨迹适合承载已公开的运行、工具或任务事件。不得用它展示模型隐藏推理。

```tsx
const [expanded, setExpanded] = useState(false);

<button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
  <span>运行步骤</span>
</button>
<div className="grid transition-[grid-template-rows,opacity] duration-300"
  style={{ gridTemplateRows: expanded ? "1fr" : "0fr", opacity: expanded ? 1 : 0 }}>
  <div className="overflow-hidden">{children}</div>
</div>
```

## StreamingText

示例使用逐词出现和来源胶囊。实际实现必须直接消费 transcript 的增量内容，不能按空格或固定计时器伪造流式。

```tsx
<p className="text-[13px] leading-relaxed text-ink">
  {segments.map((segment) => (
    <span key={segment.id} style={{ animation: "stream-in 420ms cubic-bezier(0.22,0.61,0.25,1) both" }}>
      {segment.text}
    </span>
  ))}
</p>
```

## ApprovalCard

单个问题、选择项、分页和确认按钮形成清晰的人工介入卡片。只有官方审批请求给出 schema 时才能落地。

```tsx
<button type="button" aria-pressed={selected} onClick={() => choose(option.id)}>
  <span aria-hidden className={selected ? "bg-ink text-canvas" : "border border-line-strong"} />
  {option.label}
</button>
<button type="button" disabled={!hasAnswer} onClick={submitApproval}>提交</button>
```

## ToolChips

工具行通过图标、名称、参数摘要和可展开详情压缩信息密度。

```tsx
<button type="button" aria-expanded={open} onClick={() => toggle(tool.id)}>
  <ToolIcon kind={tool.kind} />
  <span>{tool.label}</span>
  <code className="truncate rounded-chip bg-hover-2 px-1.5">{tool.summary}</code>
</button>
{open ? <pre className="border-l border-line pl-3.5">{tool.detail}</pre> : null}
```

## TaskRows

任务行使用状态环、结果标签和下拉详情。示例中的固定时序只能用于展示，真实状态必须来自 Task Ledger。

```tsx
<button type="button" aria-expanded={open} onClick={() => toggle(task.id)}>
  <TaskStatus status={task.status} />
  <span className="flex-1 truncate">{task.label}</span>
  <span className="tabular-nums">{task.meta}</span>
</button>
```

## ChatComposer

聊天卡固定会话阅读区和输入区，避免消息到达时改变主要操作的位置。

```tsx
<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3">{messages}</div>
<form onSubmit={send} className="shrink-0 border border-line bg-field p-2.5">
  <input aria-label="聊天输入" value={draft} onChange={onDraftChange} />
  <button type="submit" disabled={!canSend}>发送</button>
</form>
```

## PromptBar

用户提供的示例包含附件、来源、命令、模型、听写、菜单键盘导航和输入框自适应高度。JunQi 只能保留已被官方能力确认的入口。

```tsx
const token = /(^|\s)([@/])([\w-]*)$/.exec(draft);

<textarea
  value={draft}
  onKeyDown={(event) => {
    if (event.key === "Escape") closeMenus();
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }}
/>
```

## RecommendationCard

主建议、替代项、置信信息与确认按钮应始终呈现其证据来源。不能把本地规则或模型文本包装成可执行决定。

```tsx
<button type="button" aria-expanded={alternativesOpen} onClick={toggleAlternatives}>替代方案</button>
<button type="button" onClick={accept} disabled={!recommendation.canAccept}>
  {recommendation.actionLabel}
</button>
```

## ContextCards

来源卡可展示片段标题、正文、来源和类型标签，但每一项都必须有实际的官方来源字段。

```tsx
<article className="rounded-card bg-surface shadow-card">
  <header className="border-b border-line">{chunk.title}</header>
  <p>{chunk.body}</p>
  <button type="button" onClick={() => openSource(chunk.source)}>{chunk.source.label}</button>
</article>
```

## DiffTable

差异表以删除色、增加色和稳定行展示变更。它只能展示真实文件差异或已验证的结构化变更。

```tsx
<tr style={{ background: row.removed ? "var(--red-tint)" : undefined }}>
  <td style={{ textDecorationLine: row.removed ? "line-through" : "none" }}>{row.value}</td>
</tr>
```

## RecordsTable

宽表格的关键是固定首列、明确的横向滚动边界、排序、选择和标签密度。不要把展示数组视为运行时数据模型。

```tsx
const visibleRows = useMemo(
  () => [...rows].sort((left, right) => compare(left, right, sort)),
  [rows, sort],
);

<div className="records-scroll" tabIndex={0} aria-label="记录表，可横向和纵向滚动">
  <table>{/* 仅承载权威数据源返回的字段 */}</table>
</div>
```

## FilterTable

筛选胶囊应直接映射服务端或权威数据源支持的筛选条件；切换时只改变真实结果集。

```tsx
{filters.map((filter) => (
  <button key={filter.key} type="button" aria-pressed={active === filter.key} onClick={() => setActive(filter.key)}>
    {filter.label}
    <span className="tabular-nums">{filter.count}</span>
  </button>
))}
```
