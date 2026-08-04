import type {
  TalkGatewayEvent,
  TalkRelayEvent,
} from '@/services/gateway/talkEventBridge';
import {
  decodeTalkAgentControlInput,
  decodeTalkTextPayload,
  type TalkAudioFormat,
} from '@/services/gateway/talkTypes';
import {
  TALK_AGENT_CONSULT_TOOL_NAME,
  TALK_AGENT_CONTROL_TOOL_NAME,
  type TalkGatewayConnectionClient,
  type TalkGatewayClient,
  type TalkOutputCancelReason,
  type TalkToolResultOptions,
} from '@/services/gateway/TalkGatewayClient';
import type { VoiceInterruptControl } from './types';

const MAX_PENDING_AUDIO_APPENDS = 4;
const MAX_TRANSCRIPT_LENGTH = 8_000;

export type TalkConversationPhase =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

export type TalkConversationErrorCode =
  | 'gateway_unavailable'
  | 'connection_changed'
  | 'audio_format_mismatch'
  | 'audio_append_failed'
  | 'audio_playback_failed'
  | 'talk_session_replaced'
  | 'talk_session_closed'
  | 'talk_session_error';

export interface TalkConversationSnapshot {
  phase: TalkConversationPhase;
  sessionId: string | null;
  sessionKey: string | null;
  connectionId: string | null;
  inputAudioFormat: TalkAudioFormat | null;
  outputAudioFormat: TalkAudioFormat | null;
  userTranscript: string;
  assistantText: string;
  error: TalkConversationErrorCode | null;
  errorDetail: string | null;
}

declare const talkConversationLeaseBrand: unique symbol;

export interface TalkConversationLease {
  readonly sessionKey: string;
  readonly [talkConversationLeaseBrand]: true;
}

export interface TalkConversationAcceptance {
  snapshot: TalkConversationSnapshot;
  lease: TalkConversationLease | null;
}

export interface TalkPcmFrame {
  data: string;
  sampleRateHz: number;
  channels: number;
}

export interface TalkConversationDependencies {
  client: Pick<
    TalkGatewayClient,
    | 'bindConnection'
    | 'subscribe'
    | 'subscribeRelay'
  >;
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  interruptLocalOutput: (sessionKey: string) => void;
  playOutput: (
    audioBase64: string,
    format: TalkAudioFormat,
  ) => 'queued' | 'overflow' | Promise<'queued' | 'overflow'>;
  finishOutput: () => void | Promise<void>;
  stopOutput: () => void | Promise<void>;
  now?: () => number;
}

type Listener = (snapshot: TalkConversationSnapshot) => void;

interface TalkToolExecution {
  callId: string;
  sessionId: string;
  sessionKey: string;
  generation: number;
  controller: AbortController;
  runId: string | null;
  abortOperation: Promise<void> | null;
  client: TalkGatewayConnectionClient;
}

interface PlaybackIdleWaiter {
  sessionId: string;
  resolve: () => void;
  cleanup: () => void;
}

const INITIAL: TalkConversationSnapshot = {
  phase: 'idle',
  sessionId: null,
  sessionKey: null,
  connectionId: null,
  inputAudioFormat: null,
  outputAudioFormat: null,
  userTranscript: '',
  assistantText: '',
  error: null,
  errorDetail: null,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function boundedText(value: string): string {
  return value.length <= MAX_TRANSCRIPT_LENGTH
    ? value
    : value.slice(value.length - MAX_TRANSCRIPT_LENGTH);
}

function forcedConsultWorkingResult(): Record<string, unknown> {
  return {
    status: 'working',
    tool: TALK_AGENT_CONSULT_TOOL_NAME,
    message: 'Tell the person briefly that you are checking, then wait for the final OpenClaw result before answering with the actual result.',
  };
}

/** 只允许匹配会话中正在播放的 Talk 输出响应外部抢占。 */
export function shouldCancelTalkOutput(
  snapshot: TalkConversationSnapshot,
  control: VoiceInterruptControl | null | undefined,
): boolean {
  return Boolean(
    control?.cancelTalk
    && snapshot.phase === 'speaking'
    && snapshot.sessionKey
    && (!control.sessionKey || control.sessionKey === snapshot.sessionKey),
  );
}

export class TalkConversationCoordinator {
  private snapshot = INITIAL;
  private unsubscribeEvents: (() => void) | null = null;
  private unsubscribeRelayEvents: (() => void) | null = null;
  private opening: Promise<TalkConversationAcceptance> | null = null;
  private openingSessionKey: string | null = null;
  private activeLease: TalkConversationLease | null = null;
  private sessionClient: TalkGatewayConnectionClient | null = null;
  private interruptOperation: {
    sessionId: string;
    promise: Promise<void>;
  } | null = null;
  private generation = 0;
  private activeTurnId: string | null = null;
  private cancelledOutputTurnId: string | null = null;
  private audioAppendAbortController: AbortController | null = null;
  private readonly pendingAudioAppends = new Set<Promise<void>>();
  private playbackQueue: Promise<void> = Promise.resolve();
  private playbackGeneration = 0;
  private playbackSessionId: string | null = null;
  private readonly playbackIdleWaiters = new Set<PlaybackIdleWaiter>();
  private readonly toolExecutions = new Map<string, TalkToolExecution>();
  private readonly completedToolCalls = new Set<string>();
  private readonly submittingToolCalls = new Set<string>();
  private readonly listeners = new Set<Listener>();
  private readonly now: () => number;

  constructor(private readonly dependencies: TalkConversationDependencies) {
    this.now = dependencies.now ?? (() => Date.now());
  }

  getSnapshot = (): TalkConversationSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(next: TalkConversationSnapshot): void {
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener(next);
  }

  private ownsSession(snapshot: TalkConversationSnapshot = this.snapshot): boolean {
    return Boolean(
      snapshot.sessionId
      && snapshot.connectionId
      && this.sessionClient?.connectionId === snapshot.connectionId
      && this.dependencies.isConnectionCurrent(snapshot.connectionId),
    );
  }

  acceptInput(sessionKey: string): Promise<TalkConversationAcceptance> {
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedSessionKey) {
      return Promise.resolve({
        snapshot: {
          ...INITIAL,
          phase: 'error',
          error: 'gateway_unavailable',
          errorDetail: 'Talk requires a non-empty OpenClaw session key',
        },
        lease: null,
      });
    }
    if (this.opening && this.openingSessionKey === normalizedSessionKey) return this.opening;
    if (
      this.snapshot.sessionKey === normalizedSessionKey
      && this.snapshot.sessionId
      && this.ownsSession()
      && this.activeLease
    ) {
      const lease = this.activeLease;
      if (this.snapshot.phase !== 'speaking') {
        return Promise.resolve({ snapshot: this.snapshot, lease });
      }
      return this.interrupt().then(() => ({ snapshot: this.snapshot, lease }));
    }

    const generation = ++this.generation;
    const lease = {
      sessionKey: normalizedSessionKey,
    } as TalkConversationLease;
    this.activeLease = lease;
    const opening = this.openSession(normalizedSessionKey, generation, lease);
    this.opening = opening;
    this.openingSessionKey = normalizedSessionKey;
    void opening.finally(() => {
      if (this.opening === opening) {
        this.opening = null;
        this.openingSessionKey = null;
      }
    });
    return opening;
  }

  ownsLease(lease: TalkConversationLease | null | undefined): boolean {
    return Boolean(lease && this.activeLease === lease);
  }

  async stopOwnedLease(lease: TalkConversationLease | null | undefined): Promise<boolean> {
    if (!this.ownsLease(lease)) return false;
    await this.stop();
    return true;
  }

  private async openSession(
    sessionKey: string,
    generation: number,
    lease: TalkConversationLease,
  ): Promise<TalkConversationAcceptance> {
    const previous = this.snapshot;
    const previousTurnId = this.activeTurnId;
    const ownedPrevious = this.ownsSession(previous);
    const previousClient = this.sessionClient;
    this.detachSession();
    this.set({ ...INITIAL, phase: 'connecting', sessionKey });
    await this.stopNativeOutput();
    if (previous.sessionId && ownedPrevious && previousClient) {
      await previousClient.cancelTurn(previous.sessionId, previousTurnId).catch(() => undefined);
      await previousClient.close(previous.sessionId).catch(() => undefined);
    }
    if (generation !== this.generation) return { snapshot: this.snapshot, lease };

    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) {
      this.set({
        ...INITIAL,
        phase: 'error',
        sessionKey,
        error: 'gateway_unavailable',
        errorDetail: 'No attested Gateway connection is available for Talk',
      });
      return { snapshot: this.snapshot, lease };
    }
    this.set({ ...INITIAL, phase: 'connecting', sessionKey, connectionId });

    try {
      const sessionClient = this.dependencies.client.bindConnection(connectionId);
      const session = await sessionClient.createRealtimeRelay(sessionKey);
      if (generation !== this.generation || !this.dependencies.isConnectionCurrent(connectionId)) {
        await sessionClient.close(session.sessionId).catch(() => undefined);
        if (generation === this.generation) {
          this.set({
            ...INITIAL,
            phase: 'error',
            sessionKey,
            error: 'connection_changed',
            errorDetail: 'Gateway connection changed while creating the Talk session',
          });
        }
        return { snapshot: this.snapshot, lease };
      }
      this.unsubscribeEvents = this.dependencies.client.subscribe((event) => this.handleEvent(event));
      this.unsubscribeRelayEvents = this.dependencies.client.subscribeRelay(
        (event) => this.handleRelayEvent(event),
      );
      this.sessionClient = sessionClient;
      this.audioAppendAbortController = new AbortController();
      this.set({
        ...INITIAL,
        phase: 'listening',
        sessionId: session.sessionId,
        sessionKey,
        connectionId,
        inputAudioFormat: { ...session.inputAudioFormat },
        outputAudioFormat: { ...session.outputAudioFormat },
      });
    } catch (error) {
      if (generation === this.generation) {
        this.set({
          ...INITIAL,
          phase: 'error',
          sessionKey,
          connectionId,
          error: 'gateway_unavailable',
          errorDetail: errorMessage(error),
        });
      }
    }
    return { snapshot: this.snapshot, lease };
  }

  appendPcm(frame: TalkPcmFrame): boolean {
    const { inputAudioFormat, sessionId } = this.snapshot;
    const abortController = this.audioAppendAbortController;
    const sessionClient = this.sessionClient;
    if (!sessionId || !inputAudioFormat || !abortController || !sessionClient
      || abortController.signal.aborted || !this.ownsSession()) {
      return false;
    }
    if (
      frame.sampleRateHz !== inputAudioFormat.sampleRateHz
      || frame.channels !== inputAudioFormat.channels
      || !frame.data
    ) {
      void this.terminateWithError(
        'audio_format_mismatch',
        'Native capture format does not match the advertised Talk input format',
      );
      return false;
    }

    if (this.pendingAudioAppends.size >= MAX_PENDING_AUDIO_APPENDS) return false;

    const generation = this.generation;
    const request = sessionClient.appendAudio(
      sessionId,
      frame.data,
      this.now(),
      abortController.signal,
    )
      .catch(async (error) => {
        if (generation === this.generation && this.snapshot.sessionId === sessionId) {
          await this.terminateWithError('audio_append_failed', errorMessage(error));
        }
      });
    this.pendingAudioAppends.add(request);
    void request.finally(() => this.pendingAudioAppends.delete(request));
    return true;
  }

  async interrupt(reason: TalkOutputCancelReason = 'barge-in'): Promise<void> {
    const snapshot = this.snapshot;
    const sessionId = snapshot.sessionId;
    const sessionKey = snapshot.sessionKey;
    const sessionClient = this.sessionClient;
    if (!sessionId || !sessionKey || !sessionClient || !this.ownsSession(snapshot)) return;
    if (this.interruptOperation?.sessionId === sessionId) {
      return this.interruptOperation.promise;
    }

    const operation = this.performInterrupt(sessionClient, sessionId, sessionKey, reason);
    this.interruptOperation = { sessionId, promise: operation };
    const clearOperation = () => {
      if (this.interruptOperation?.promise === operation) this.interruptOperation = null;
    };
    void operation.then(clearOperation, clearOperation);
    return operation;
  }

  private async performInterrupt(
    sessionClient: TalkGatewayConnectionClient,
    sessionId: string,
    sessionKey: string,
    reason: TalkOutputCancelReason,
  ): Promise<void> {
    const outputTurnId = this.activeTurnId;
    this.cancelledOutputTurnId = outputTurnId;
    this.abortToolExecutions();
    this.dependencies.interruptLocalOutput(sessionKey);
    await this.stopNativeOutput();
    try {
      await sessionClient.cancelOutput(sessionId, outputTurnId, reason);
      if (this.snapshot.sessionId === sessionId && this.snapshot.phase !== 'error') {
        this.set({ ...this.snapshot, phase: 'listening', assistantText: '', error: null, errorDetail: null });
      }
    } catch (error) {
      if (this.snapshot.sessionId === sessionId) {
        await this.terminateWithError('talk_session_error', errorMessage(error));
      }
    }
  }

  async stop(): Promise<void> {
    this.generation += 1;
    const snapshot = this.snapshot;
    const activeTurnId = this.activeTurnId;
    const ownedSession = this.ownsSession(snapshot);
    const sessionClient = this.sessionClient;
    this.opening = null;
    this.openingSessionKey = null;
    this.activeLease = null;
    this.detachSession();
    this.set(INITIAL);
    await this.stopNativeOutput();
    if (snapshot.sessionId && ownedSession && sessionClient) {
      await sessionClient.cancelTurn(snapshot.sessionId, activeTurnId).catch(() => undefined);
      await sessionClient.close(snapshot.sessionId).catch(() => undefined);
    }
  }

  private detachSession(): void {
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    this.unsubscribeRelayEvents?.();
    this.unsubscribeRelayEvents = null;
    this.abortToolExecutions();
    this.sessionClient = null;
    this.completedToolCalls.clear();
    this.submittingToolCalls.clear();
    this.audioAppendAbortController?.abort();
    this.audioAppendAbortController = null;
    this.activeTurnId = null;
    this.cancelledOutputTurnId = null;
    this.pendingAudioAppends.clear();
  }

  private handleRelayEvent(event: TalkRelayEvent): void {
    if (event.relaySessionId !== this.snapshot.sessionId || !this.ownsSession()) return;
    if (event.type === 'protocolError') {
      void this.terminateWithError(
        'talk_session_error',
        `Gateway returned a malformed Talk relay ${event.issue} event`,
      );
      return;
    }
    if (event.type === 'audio') {
      if (event.turnId === this.cancelledOutputTurnId) return;
      this.enqueueOutput(event.relaySessionId, event.audioBase64);
      return;
    }
    if (event.type === 'clear') {
      this.clearRelayOutput(event.relaySessionId, event.turnId);
      return;
    }
    if (event.type === 'mark') {
      this.acknowledgeRelayMark(event.relaySessionId, event.markName);
      return;
    }
    if (event.type === 'toolCall') {
      this.startToolExecution(event);
      return;
    }
    const execution = this.toolExecutions.get(event.callId);
    if (event.type === 'toolCallCancelled') {
      this.completedToolCalls.add(event.callId);
      if (execution) this.abortToolExecution(execution);
      return;
    }
    if (!event.final) return;
    this.completedToolCalls.add(event.callId);
    if (execution && !this.submittingToolCalls.has(event.callId)) {
      this.abortToolExecution(execution);
    }
  }

  private startToolExecution(event: Extract<TalkRelayEvent, { type: 'toolCall' }>): void {
    if (this.completedToolCalls.has(event.callId) || this.toolExecutions.has(event.callId)) return;
    const sessionId = this.snapshot.sessionId;
    const sessionKey = this.snapshot.sessionKey;
    const sessionClient = this.sessionClient;
    if (!sessionId || !sessionKey || !sessionClient) return;
    const execution: TalkToolExecution = {
      callId: event.callId,
      sessionId,
      sessionKey,
      generation: this.generation,
      controller: new AbortController(),
      runId: null,
      abortOperation: null,
      client: sessionClient,
    };
    this.toolExecutions.set(event.callId, execution);
    void this.performToolExecution(execution, event).finally(() => {
      if (this.toolExecutions.get(event.callId) === execution) {
        this.toolExecutions.delete(event.callId);
      }
    });
  }

  private async performToolExecution(
    execution: TalkToolExecution,
    event: Extract<TalkRelayEvent, { type: 'toolCall' }>,
  ): Promise<void> {
    let result: unknown;
    try {
      if (event.name === TALK_AGENT_CONTROL_TOOL_NAME) {
        const input = decodeTalkAgentControlInput(event.args);
        if (!input) throw new Error('Talk agent control arguments are invalid');
        result = await execution.client.steerAgent(
          execution.sessionId,
          execution.sessionKey,
          input,
        );
      } else if (event.name === TALK_AGENT_CONSULT_TOOL_NAME) {
        if (event.forced) {
          try {
            const submitted = await this.submitToolResultForExecution(
              execution,
              forcedConsultWorkingResult(),
              { willContinue: true },
            );
            if (!submitted) return;
          } catch (error) {
            await this.failToolResultSubmission(execution, error);
            return;
          }
        }
        const started = await execution.client.startAgentConsult(
          execution.sessionKey,
          execution.sessionId,
          execution.callId,
          event.args,
        );
        execution.runId = started.runId;
        if (execution.controller.signal.aborted) {
          await this.abortToolRun(execution);
          return;
        }
        const text = await execution.client.waitForAgentConsult(
          started.runId,
          execution.controller.signal,
        );
        result = { result: text };
      } else {
        result = { error: `Tool "${event.name}" is not available in this Talk client` };
      }
    } catch (error) {
      if (execution.controller.signal.aborted || !this.isToolExecutionCurrent(execution)) {
        await this.abortToolRun(execution);
        return;
      }
      result = { error: errorMessage(error) };
    }

    await this.waitForPlaybackIdle(execution.sessionId, execution.controller.signal);
    if (execution.controller.signal.aborted || !this.isToolExecutionCurrent(execution)) {
      await this.abortToolRun(execution);
      return;
    }
    try {
      await this.submitToolResultForExecution(execution, result);
    } catch (error) {
      await this.failToolResultSubmission(execution, error);
    }
  }

  private isToolExecutionCurrent(execution: TalkToolExecution): boolean {
    return this.toolExecutions.get(execution.callId) === execution
      && execution.generation === this.generation
      && execution.sessionId === this.snapshot.sessionId
      && execution.sessionKey === this.snapshot.sessionKey
      && execution.client === this.sessionClient
      && this.ownsSession();
  }

  private async submitToolResultForExecution(
    execution: TalkToolExecution,
    result: unknown,
    options?: TalkToolResultOptions,
  ): Promise<boolean> {
    if (!this.isToolExecutionCurrent(execution) || this.completedToolCalls.has(execution.callId)) {
      return false;
    }
    this.submittingToolCalls.add(execution.callId);
    try {
      await execution.client.submitToolResult(
        execution.sessionId,
        execution.callId,
        result,
        options,
      );
      return true;
    } finally {
      this.submittingToolCalls.delete(execution.callId);
    }
  }

  private async failToolResultSubmission(execution: TalkToolExecution, error: unknown): Promise<void> {
    if (!this.isToolExecutionCurrent(execution)) return;
    await this.terminateWithError('talk_session_error', errorMessage(error));
  }

  private abortToolExecution(execution: TalkToolExecution): void {
    execution.controller.abort();
    if (this.toolExecutions.get(execution.callId) === execution) {
      this.toolExecutions.delete(execution.callId);
    }
    void this.abortToolRun(execution);
  }

  private abortToolExecutions(): void {
    for (const execution of [...this.toolExecutions.values()]) {
      this.abortToolExecution(execution);
    }
  }

  private abortToolRun(execution: TalkToolExecution): Promise<void> {
    if (!execution.runId) return Promise.resolve();
    execution.abortOperation ??= execution.client.abortAgentConsult(
      execution.sessionKey,
      execution.runId,
    ).catch(() => undefined);
    return execution.abortOperation;
  }

  private handleEvent(event: TalkGatewayEvent): void {
    if (event.sessionId !== this.snapshot.sessionId || !this.ownsSession()) return;
    if (event.type === 'session.ready') {
      this.set({ ...this.snapshot, phase: 'listening', error: null, errorDetail: null });
      return;
    }
    if (event.type === 'session.replaced') {
      void this.terminateWithError('talk_session_replaced', null, false);
      return;
    }
    if (event.type === 'session.error') {
      void this.terminateWithError('talk_session_error', null);
      return;
    }
    if (event.type === 'session.closed') {
      void this.terminateWithError('talk_session_closed', null, false);
      return;
    }
    if (event.type === 'turn.started') {
      this.activeTurnId = event.turnId;
      this.cancelledOutputTurnId = null;
      this.set({
        ...this.snapshot,
        phase: 'listening',
        userTranscript: '',
        assistantText: '',
        error: null,
        errorDetail: null,
      });
      return;
    }
    if (event.type === 'transcript.delta' || event.type === 'transcript.done') {
      const payload = decodeTalkTextPayload(event.payload);
      if (!payload) return;
      this.activeTurnId = event.turnId;
      this.set({
        ...this.snapshot,
        phase: event.type === 'transcript.done' ? 'thinking' : 'listening',
        userTranscript: boundedText(
          event.type === 'transcript.done'
            ? payload.text
            : `${this.snapshot.userTranscript}${payload.text}`,
        ),
      });
      return;
    }
    if (event.type === 'output.text.delta' || event.type === 'output.text.done') {
      if (event.turnId === this.cancelledOutputTurnId) return;
      const payload = decodeTalkTextPayload(event.payload);
      if (!payload) return;
      this.activeTurnId = event.turnId;
      this.set({
        ...this.snapshot,
        phase: this.snapshot.phase === 'speaking' ? 'speaking' : 'thinking',
        assistantText: boundedText(
          event.type === 'output.text.done'
            ? payload.text
            : `${this.snapshot.assistantText}${payload.text}`,
        ),
      });
      return;
    }
    if (event.type === 'tool.call' || event.type === 'tool.progress'
      || event.type === 'tool.result' || event.type === 'tool.error') {
      if (event.turnId === this.cancelledOutputTurnId) return;
      this.activeTurnId = event.turnId;
      this.set({ ...this.snapshot, phase: 'thinking' });
      return;
    }
    if (event.type === 'output.audio.started' || event.type === 'output.audio.delta') {
      if (event.turnId === this.cancelledOutputTurnId) return;
      this.activeTurnId = event.turnId;
      this.set({ ...this.snapshot, phase: 'speaking', error: null, errorDetail: null });
      return;
    }
    if (event.type === 'output.audio.done') {
      if (event.turnId === this.cancelledOutputTurnId) return;
      this.finishOutput(event.sessionId, event.turnId);
      return;
    }
    if (event.type === 'turn.cancelled') {
      if (!event.turnId || event.turnId === this.activeTurnId || event.turnId === this.cancelledOutputTurnId) {
        const cancelledTurnId = event.turnId ?? this.activeTurnId ?? this.cancelledOutputTurnId;
        this.abortToolExecutions();
        this.activeTurnId = null;
        this.cancelledOutputTurnId = cancelledTurnId;
        if (this.playbackSessionId) void this.stopNativeOutput();
        this.set({ ...this.snapshot, phase: 'listening', assistantText: '' });
      }
      return;
    }
    if (event.type === 'turn.ended' && event.turnId === this.activeTurnId) {
      if (this.snapshot.phase !== 'speaking') {
        this.activeTurnId = null;
        this.set({ ...this.snapshot, phase: 'listening' });
      }
    }
  }

  private async terminateWithError(
    code: TalkConversationErrorCode,
    detail: string | null,
    closeSession = true,
  ): Promise<void> {
    this.generation += 1;
    const snapshot = this.snapshot;
    const turnId = this.activeTurnId;
    const ownedSession = this.ownsSession(snapshot);
    const sessionClient = this.sessionClient;
    this.opening = null;
    this.openingSessionKey = null;
    this.activeLease = null;
    this.detachSession();
    this.set({
      ...INITIAL,
      phase: 'error',
      sessionKey: snapshot.sessionKey,
      connectionId: snapshot.connectionId,
      userTranscript: snapshot.userTranscript,
      assistantText: snapshot.assistantText,
      error: code,
      errorDetail: detail,
    });
    await this.stopNativeOutput();
    if (closeSession && snapshot.sessionId && ownedSession && sessionClient) {
      await sessionClient.cancelTurn(snapshot.sessionId, turnId).catch(() => undefined);
      await sessionClient.close(snapshot.sessionId).catch(() => undefined);
    }
  }

  private enqueueOutput(sessionId: string, audioBase64: string): void {
    const format = this.snapshot.outputAudioFormat;
    if (!format) {
      void this.terminateWithError('audio_format_mismatch', 'Talk output format is unavailable');
      return;
    }
    const playbackGeneration = this.playbackGeneration;
    this.playbackSessionId = sessionId;
    this.playbackQueue = this.playbackQueue
      .then(async () => {
        if (
          playbackGeneration !== this.playbackGeneration
          || this.snapshot.sessionId !== sessionId
          || !this.ownsSession()
        ) return;
        const result = await this.dependencies.playOutput(audioBase64, format);
        if (
          result === 'overflow'
          && playbackGeneration === this.playbackGeneration
          && this.snapshot.sessionId === sessionId
        ) {
          await this.interrupt('playback-overflow');
        }
      })
      .catch((error) => {
        if (playbackGeneration === this.playbackGeneration && this.snapshot.sessionId === sessionId) {
          void this.terminateWithError('audio_playback_failed', errorMessage(error));
        }
      });
  }

  private clearRelayOutput(sessionId: string, turnId: string | null): void {
    const clearedTurnId = turnId ?? this.activeTurnId;
    if (clearedTurnId) this.cancelledOutputTurnId = clearedTurnId;
    this.activeTurnId = null;
    const stopping = this.stopNativeOutput();
    if (this.snapshot.sessionId === sessionId && this.snapshot.phase !== 'error') {
      this.set({ ...this.snapshot, phase: 'listening' });
    }
    void stopping;
  }

  private acknowledgeRelayMark(sessionId: string, markName: string): void {
    const controller = this.audioAppendAbortController;
    const sessionClient = this.sessionClient;
    const generation = this.generation;
    if (!controller || !sessionClient) return;
    void this.waitForPlaybackIdle(sessionId, controller.signal)
      .then(async () => {
        if (controller.signal.aborted || generation !== this.generation
          || this.snapshot.sessionId !== sessionId || !this.ownsSession()) return;
        await sessionClient.acknowledgeMark(sessionId, markName);
      })
      .catch((error) => {
        if (!controller.signal.aborted && generation === this.generation
          && this.snapshot.sessionId === sessionId) {
          void this.terminateWithError('talk_session_error', errorMessage(error));
        }
      });
  }

  private waitForPlaybackIdle(sessionId: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted || this.playbackSessionId !== sessionId) return Promise.resolve();
    return new Promise((resolve) => {
      const waiter: PlaybackIdleWaiter = {
        sessionId,
        resolve: () => {
          waiter.cleanup();
          resolve();
        },
        cleanup: () => undefined,
      };
      const onAbort = () => waiter.resolve();
      waiter.cleanup = () => {
        this.playbackIdleWaiters.delete(waiter);
        signal.removeEventListener('abort', onAbort);
      };
      this.playbackIdleWaiters.add(waiter);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted || this.playbackSessionId !== sessionId) waiter.resolve();
    });
  }

  private resolvePlaybackIdle(sessionId?: string): void {
    for (const waiter of [...this.playbackIdleWaiters]) {
      if (!sessionId || waiter.sessionId === sessionId) waiter.resolve();
    }
  }

  private finishOutput(sessionId: string, turnId: string | null): void {
    if (turnId && this.activeTurnId && turnId !== this.activeTurnId) return;
    if (this.playbackSessionId !== sessionId) {
      this.activeTurnId = null;
      this.resolvePlaybackIdle(sessionId);
      this.set({ ...this.snapshot, phase: 'listening' });
      return;
    }
    const playbackGeneration = this.playbackGeneration;
    this.playbackQueue = this.playbackQueue
      .then(async () => {
        if (
          playbackGeneration !== this.playbackGeneration
          || this.snapshot.sessionId !== sessionId
          || !this.ownsSession()
        ) return;
        await this.dependencies.finishOutput();
        if (
          playbackGeneration === this.playbackGeneration
          && this.snapshot.sessionId === sessionId
          && (!turnId || this.activeTurnId === turnId)
        ) {
          this.playbackSessionId = null;
          this.resolvePlaybackIdle(sessionId);
          this.activeTurnId = null;
          this.set({ ...this.snapshot, phase: 'listening' });
        }
      })
      .catch((error) => {
        if (playbackGeneration === this.playbackGeneration && this.snapshot.sessionId === sessionId) {
          void this.terminateWithError('audio_playback_failed', errorMessage(error));
        }
      });
  }

  private async stopNativeOutput(): Promise<void> {
    this.playbackGeneration += 1;
    this.playbackSessionId = null;
    this.resolvePlaybackIdle();
    this.playbackQueue = Promise.resolve();
    await Promise.resolve(this.dependencies.stopOutput()).catch(() => undefined);
  }
}
