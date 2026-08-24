export interface DingTalkRuntimeEvidenceInput {
  readonly sessionLabel: string | null;
  readonly agentId: string | null;
  readonly effectiveToolCount: number;
  readonly pluginVersion: string | null;
  readonly bundledPluginVersion: string | null;
}

export interface DingTalkRuntimeEvidencePresentation {
  readonly sessionVerified: boolean;
  readonly agentId: string | null;
  readonly effectiveToolCount: number;
  readonly diagnostics: {
    readonly sessionLabel: string | null;
    readonly pluginVersion: string | null;
    readonly bundledPluginVersion: string | null;
  };
}

export function presentDingTalkRuntimeEvidence(
  input: DingTalkRuntimeEvidenceInput,
): DingTalkRuntimeEvidencePresentation {
  return {
    sessionVerified: input.sessionLabel !== null,
    agentId: input.agentId,
    effectiveToolCount: input.effectiveToolCount,
    diagnostics: {
      sessionLabel: input.sessionLabel,
      pluginVersion: input.pluginVersion,
      bundledPluginVersion: input.bundledPluginVersion,
    },
  };
}
