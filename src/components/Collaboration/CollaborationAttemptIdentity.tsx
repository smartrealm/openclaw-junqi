import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CollaborationAttemptSnapshot } from '@/services/collaboration/types';
import {
  useCollaborationText,
  type CollaborationTranslate,
} from './CollaborationCard';

const MAX_VISIBLE_IDENTITY_LENGTH = 192;

export interface AttemptIdentityField {
  key: 'executionTaskId' | 'agentRunId' | 'workerSessionKey' | 'workerSessionId';
  value: string;
  visibleValue: string;
}

function boundedIdentity(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= MAX_VISIBLE_IDENTITY_LENGTH) return normalized;
  const edgeLength = Math.floor((MAX_VISIBLE_IDENTITY_LENGTH - 3) / 2);
  return `${normalized.slice(0, edgeLength)}...${normalized.slice(-edgeLength)}`;
}

export function collaborationAttemptIdentityFields(
  attempt: CollaborationAttemptSnapshot,
): AttemptIdentityField[] {
  const fields: AttemptIdentityField[] = [];
  for (const key of [
    'executionTaskId',
    'agentRunId',
    'workerSessionKey',
    'workerSessionId',
  ] as const) {
    const value = attempt[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    fields.push({ key, value: value.trim(), visibleValue: boundedIdentity(value) });
  }
  return fields;
}

function CopyIdentityButton({
  value,
  label,
  copyLabel,
}: {
  value: string;
  label: string;
  copyLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  const copy = async () => {
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-aegis-text-dim hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text"
      aria-label={copyLabel}
      title={copyLabel}
      data-copy-attempt-identity={label}
    >
      {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
    </button>
  );
}

export function CollaborationAttemptIdentity({
  attempt,
  translate,
  className,
}: {
  attempt: CollaborationAttemptSnapshot;
  translate?: CollaborationTranslate;
  className?: string;
}) {
  const text = useCollaborationText(translate);
  const fields = collaborationAttemptIdentityFields(attempt);
  if (fields.length === 0) return null;

  const labels: Record<AttemptIdentityField['key'], string> = {
    executionTaskId: text('collaboration.attemptIdentity.taskId', 'OpenClaw Task'),
    agentRunId: text('collaboration.attemptIdentity.runId', 'OpenClaw Run'),
    workerSessionKey: text('collaboration.attemptIdentity.sessionKey', 'Worker session'),
    workerSessionId: text('collaboration.attemptIdentity.sessionId', 'Worker session ID'),
  };

  return (
    <dl
      className={cn('grid min-w-0 grid-cols-1 gap-x-3 gap-y-1 text-[9.5px] sm:grid-cols-2', className)}
      aria-label={text('collaboration.attemptIdentity.title', 'OpenClaw execution identity')}
      data-collaboration-attempt-identity={attempt.id}
    >
      {fields.map((field) => (
        <div key={field.key} className="min-w-0">
          <dt className="text-aegis-text-dim">{labels[field.key]}</dt>
          <dd className="mt-0.5 flex min-w-0 items-start gap-1">
            <code
              className="min-w-0 flex-1 select-text break-all font-mono text-aegis-text-muted"
              title={field.visibleValue}
              data-attempt-identity-field={field.key}
            >
              {field.visibleValue}
            </code>
            <CopyIdentityButton
              value={field.value}
              label={field.key}
              copyLabel={text('collaboration.attemptIdentity.copy', 'Copy {{label}}', {
                label: labels[field.key],
              })}
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}
