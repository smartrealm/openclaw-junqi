import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getDingTalkApprovalTraceInstanceId,
  hasDingTalkApprovalTrace,
  mergeDingTalkApprovalTraces,
  parseDingTalkApprovalTraceOutput,
  type DingTalkApprovalTraceProjection,
} from '@/business-applications/dingtalkApproval';
import {
  DINGTALK_APPROVAL_RECORDS_TOOL,
  DINGTALK_APPROVAL_TASKS_TOOL,
  parseProfileReference,
  type DingTalkDomain,
  type DingTalkEffectiveTool,
} from '@/business-applications/dingtalkTools';
import { invokeOpenClawTool } from '@/stores/gatewayDataStore';

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export function useDingTalkApprovalTrace({
  activeSessionKey,
  profile,
  selectedToolId,
  selectedDomain,
  invocationOutput,
  tools,
}: {
  activeSessionKey: string;
  profile: string;
  selectedToolId: string | null;
  selectedDomain: DingTalkDomain | null;
  invocationOutput: unknown;
  tools: readonly DingTalkEffectiveTool[];
}) {
  const [reads, setReads] = useState<readonly DingTalkApprovalTraceProjection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshSequence = useRef(0);

  const baseTrace = useMemo(() => {
    if (selectedDomain !== 'approval' || invocationOutput === undefined) return null;
    const trace = parseDingTalkApprovalTraceOutput(invocationOutput);
    return hasDingTalkApprovalTrace(trace) ? trace : null;
  }, [invocationOutput, selectedDomain]);

  const trace = useMemo(() => {
    const projections = baseTrace ? [baseTrace, ...reads] : reads;
    if (projections.length === 0) return null;
    const merged = mergeDingTalkApprovalTraces(projections);
    return hasDingTalkApprovalTrace(merged) ? merged : null;
  }, [baseTrace, reads]);

  const instanceId = trace ? getDingTalkApprovalTraceInstanceId(trace) : null;
  const traceTools = useMemo(() => tools.filter((tool) => (
    (tool.entry.id === DINGTALK_APPROVAL_RECORDS_TOOL || tool.entry.id === DINGTALK_APPROVAL_TASKS_TOOL)
    && !tool.entry.deniedBySession
  )), [tools]);
  const profileRef = parseProfileReference(profile);

  useEffect(() => {
    refreshSequence.current += 1;
    setReads([]);
    setError(null);
    setLoading(false);
  }, [activeSessionKey, invocationOutput, profile, selectedToolId]);

  const refresh = useCallback(async () => {
    if (!instanceId || !profileRef || traceTools.length === 0) return;
    const sequence = refreshSequence.current + 1;
    refreshSequence.current = sequence;
    setLoading(true);
    setError(null);
    const results = await Promise.allSettled(traceTools.map(async (tool) => {
      const result = await invokeOpenClawTool({
        name: tool.entry.id,
        sessionKey: activeSessionKey,
        args: { profile: profileRef, arguments: { processInstanceId: instanceId } },
      });
      if (!result.ok) throw new Error(result.error?.message ?? tool.entry.label);
      return parseDingTalkApprovalTraceOutput(result);
    }));
    const nextReads: DingTalkApprovalTraceProjection[] = [];
    const errors: string[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') nextReads.push(result.value);
      else errors.push(errorMessage(result.reason));
    }
    if (refreshSequence.current !== sequence) return;
    setReads(nextReads);
    setError(errors.length > 0 ? errors.join('\n') : null);
    setLoading(false);
  }, [activeSessionKey, instanceId, profileRef, traceTools]);

  const toolIds = new Set(traceTools.map((tool) => tool.entry.id));
  return {
    trace,
    loading,
    error,
    refresh,
    refreshAvailable: Boolean(instanceId && profileRef && traceTools.length > 0),
    complete: toolIds.has(DINGTALK_APPROVAL_RECORDS_TOOL) && toolIds.has(DINGTALK_APPROVAL_TASKS_TOOL),
  };
}
