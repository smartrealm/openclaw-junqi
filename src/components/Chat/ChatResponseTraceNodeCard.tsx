import {
  Bot,
  Archive,
  CheckCircle2,
  CircleDot,
  Clock3,
  FileOutput,
  History,
  ListChecks,
  MessageSquareText,
  ShieldCheck,
  SquareTerminal,
  PanelRightOpen,
  Wrench,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ChatResponseTraceNode } from './chatResponseTrace';
import { formatTraceJson, formatTraceTimestamp } from './chatResponseTracePresentation';

function nodeIcon(node: ChatResponseTraceNode) {
  switch (node.kind) {
    case 'plan': return <ListChecks size={14} />;
    case 'thinking': return <CircleDot size={14} />;
    case 'tool': return <Wrench size={14} />;
    case 'review-request': return <ShieldCheck size={14} />;
    case 'message': return <MessageSquareText size={14} />;
    case 'file-output': return <FileOutput size={14} />;
    case 'workshop-event': return <SquareTerminal size={14} />;
    case 'session-event': return <History size={14} />;
    case 'compaction': return <Archive size={14} />;
    case 'action': return <CheckCircle2 size={14} />;
    case 'artifact': return <Bot size={14} />;
  }
}

function TraceNodeDetails({ node }: { node: ChatResponseTraceNode }) {
  const { t } = useTranslation();
  if (node.kind === 'plan') {
    return (
      <div className="mt-2 space-y-1.5">
        {node.snapshot.explanation && <p className="text-[11px] leading-4 text-aegis-text-muted">{node.snapshot.explanation}</p>}
        <ol className="space-y-1">
          {node.snapshot.steps.map((step, index) => (
            <li key={`${step.title}-${index}`} className="flex items-start gap-2 text-[10.5px] leading-4 text-aegis-text-muted">
              <span className="mt-0.5 font-mono text-aegis-text-dim">{index + 1}</span>
              <span className="min-w-0 flex-1 break-words">{step.title}</span>
              <span className="shrink-0 text-aegis-text-dim">
                {t(`chat.trace.nodeStatus.${step.status === 'in_progress' ? 'inProgress' : step.status}`)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (node.kind === 'tool') {
    if (node.input === undefined && node.output === undefined && !node.error) return null;
    return (
      <details className="mt-2 text-[10.5px] text-aegis-text-muted">
        <summary className="cursor-pointer select-none text-aegis-text-secondary">{t('chat.trace.toolDetails')}</summary>
        {node.input !== undefined && (
          <div className="mt-2">
            <div className="mb-1 text-aegis-text-dim">{t('chat.trace.input')}</div>
            <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[rgb(var(--aegis-overlay)/0.04)] p-2 font-mono">{formatTraceJson(node.input)}</pre>
          </div>
        )}
        {node.output !== undefined && (
          <div className="mt-2">
            <div className="mb-1 text-aegis-text-dim">{t('chat.trace.output')}</div>
            <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[rgb(var(--aegis-overlay)/0.04)] p-2 font-mono">{node.output}</pre>
            {node.outputTruncated && (
              <p className="mt-1 text-[9.5px] text-aegis-text-dim">
                {t('chat.trace.outputTruncated', { count: node.outputOriginalLength ?? node.output.length })}
              </p>
            )}
          </div>
        )}
        {node.error && (
          <div className="mt-2">
            <div className="mb-1 text-aegis-danger/80">{t('chat.trace.toolError')}</div>
            <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md border border-aegis-danger/20 bg-aegis-danger/5 p-2 font-mono text-aegis-danger/80">{node.error}</pre>
          </div>
        )}
      </details>
    );
  }
  if (node.kind === 'review-request') {
    return (
      <div className="mt-2">
        <div className="mb-1 text-[10px] text-aegis-warning">{t('chat.trace.transcriptOnly')}</div>
        <div className="flex flex-wrap gap-1.5">
          {node.options.map((option, index) => (
            <span key={`${option.value}-${index}`} className="rounded-md border border-aegis-border px-2 py-1 text-[10px] text-aegis-text-muted">
              <span>{option.text}</span>
              <span className="ml-1.5 font-mono text-aegis-text-dim">{option.value}</span>
            </span>
          ))}
        </div>
      </div>
    );
  }
  if (node.kind === 'thinking') {
    return (
      <details className="mt-2 text-[10.5px] text-aegis-text-muted">
        <summary className="cursor-pointer select-none text-aegis-text-secondary">{t('chat.trace.viewContent')}</summary>
        <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[rgb(var(--aegis-overlay)/0.04)] p-2 font-mono">{node.content}</pre>
      </details>
    );
  }
  if (node.kind === 'file-output') {
    return <div className="mt-2 space-y-1 text-[10px] text-aegis-text-muted">{node.files.map((file, index) => <div key={`${file.path}-${index}`} className="break-all font-mono">{file.path}</div>)}</div>;
  }
  if (node.kind === 'message') {
    return <p className="mt-2 text-[10.5px] text-aegis-text-muted">{t('chat.trace.characterCount', { count: node.characterCount })}</p>;
  }
  if (node.kind === 'action') {
    return (
      <div className="mt-2 space-y-1.5">
        {node.actions.map((action, index) => (
          <div key={`${action.callbackData}-${index}`} className="rounded-md border border-aegis-border px-2 py-1 text-[10px]">
            <div className="text-aegis-text-muted">{action.text}</div>
            <div className="mt-0.5 break-all font-mono text-aegis-text-dim">{action.callbackData}</div>
          </div>
        ))}
      </div>
    );
  }
  if (node.kind === 'workshop-event') {
    return <div className="mt-2 space-y-1 text-[10.5px] text-aegis-text-muted">{node.events.map((event, index) => <div key={`${event.kind}-${index}`}><span className="font-mono text-aegis-text-dim">{event.kind}</span> {event.text}</div>)}</div>;
  }
  if (node.kind === 'session-event') {
    return <p className="mt-2 text-[10.5px] text-aegis-text-muted"><span className="font-mono text-aegis-text-dim">{node.event.kind}</span> {node.event.text}</p>;
  }
  if (node.kind === 'compaction') {
    return <p className="mt-2 text-[10.5px] text-aegis-text-muted">{t('chat.trace.compactionDescription')}</p>;
  }
  if (node.kind === 'artifact') {
    return <p className="mt-2 font-mono text-[10.5px] text-aegis-text-muted">{node.artifactType}</p>;
  }
  return null;
}

export function ChatResponseTraceNodeCard({
  node,
  onOpenSourceMessage,
}: {
  node: ChatResponseTraceNode;
  onOpenSourceMessage: () => void;
}) {
  const { t, i18n } = useTranslation();
  const label = (() => {
    switch (node.kind) {
      case 'plan': return t('chat.trace.planSnapshot', { number: node.snapshotNumber });
      case 'thinking': return t('chat.trace.thinking');
      case 'tool': return node.toolName;
      case 'review-request': return t('chat.trace.reviewRequest');
      case 'message': return t('chat.trace.assistantMessage');
      case 'file-output': return t('chat.trace.fileOutput');
      case 'workshop-event': return t('chat.trace.workshopEvent');
      case 'session-event': return t('chat.trace.sessionEvent');
      case 'compaction': return t('chat.trace.compaction');
      case 'action': return t('chat.trace.structuredAction');
      case 'artifact': return node.title || t('chat.trace.artifact');
    }
  })();

  return (
    <li className="rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.02)] px-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 shrink-0 text-aegis-text-muted">{nodeIcon(node)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 break-words text-[11px] font-medium text-aegis-text">{label}</span>
            {node.kind === 'tool' && (
              <span className="text-[9.5px] text-aegis-text-dim">
                {t(`chat.trace.nodeStatus.${node.status}`)}
              </span>
            )}
            <span className="ml-auto inline-flex items-center gap-1 text-[9px] text-aegis-text-dim">
              <Clock3 size={9} />
              {formatTraceTimestamp(node.timestamp, i18n.language)}
            </span>
            <button
              type="button"
              onClick={onOpenSourceMessage}
              className="grid size-6 shrink-0 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-aegis-primary"
              title={t('chat.trace.viewSourceRecord')}
              aria-label={t('chat.trace.viewSourceRecord')}
            >
              <PanelRightOpen size={13} />
            </button>
          </div>
          <details className="mt-1 text-[9px] text-aegis-text-dim">
            <summary className="cursor-pointer select-none">{t('chat.trace.technicalDetails')}</summary>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono">
              <span>{t('chat.trace.sourceMessage')}: {node.sourceMessageId}</span>
              <span>{t('chat.trace.sequence')}: {node.sourceSequence ?? t('chat.trace.notProvided')}</span>
              {node.kind === 'tool' && <span>{t('chat.trace.toolCall')}: {node.toolCallId || t('chat.trace.notProvided')}</span>}
            </div>
          </details>
          <TraceNodeDetails node={node} />
        </div>
      </div>
    </li>
  );
}
