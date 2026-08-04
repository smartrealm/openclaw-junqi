import { useCallback, useEffect, useRef, useState } from 'react';
import { openClawSessionCompanionClient } from '@/services/gateway';
import {
  OpenClawSessionCompanionBusyError,
  OpenClawSessionCompanionUnavailableError,
  type OpenClawSessionCompanionExchange,
} from '@/services/gateway/OpenClawSessionCompanionClient';

export type OpenClawSessionCompanionFailure = 'busy' | 'unavailable' | 'invalid';

interface OpenClawSessionCompanionThread {
  readonly exchanges: readonly OpenClawSessionCompanionExchange[];
  readonly draft: string;
  readonly pendingQuestion: string | null;
  readonly failedQuestion: string | null;
  readonly failure: OpenClawSessionCompanionFailure | null;
  readonly loading: boolean;
}

const EMPTY_THREAD: OpenClawSessionCompanionThread = {
  exchanges: [],
  draft: '',
  pendingQuestion: null,
  failedQuestion: null,
  failure: null,
  loading: false,
};

/** Companion 线程仅投影当前 Gateway 的临时内存，切换会话或连接后重新读取。 */
export function useOpenClawSessionCompanion(sessionKey: string, active: boolean) {
  const [thread, setThread] = useState<OpenClawSessionCompanionThread>(EMPTY_THREAD);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const key = sessionKey.trim();
    if (!active || !key) return;
    const version = ++requestVersion.current;
    setThread((current) => ({ ...current, loading: true, failure: null, failedQuestion: null }));
    try {
      const state = await openClawSessionCompanionClient.getState(key);
      if (requestVersion.current === version) {
        setThread((current) => ({ ...current, exchanges: state.exchanges, loading: false }));
      }
    } catch (error) {
      if (requestVersion.current === version) {
        setThread((current) => ({
          ...current,
          loading: false,
          failure: error instanceof OpenClawSessionCompanionUnavailableError ? 'unavailable' : 'invalid',
        }));
      }
    }
  }, [active, sessionKey]);

  const setDraft = useCallback((draft: string) => {
    setThread((current) => ({ ...current, draft }));
  }, []);

  const ask = useCallback(async () => {
    const key = sessionKey.trim();
    if (!active || !key) return;
    let question = '';
    setThread((current) => {
      question = current.draft.trim();
      if (!question || question.length > 400 || current.pendingQuestion) return current;
      return {
        ...current,
        draft: '',
        pendingQuestion: question,
        failedQuestion: null,
        failure: null,
      };
    });
    if (!question) return;
    const version = ++requestVersion.current;
    try {
      const answer = await openClawSessionCompanionClient.ask(key, question);
      if (requestVersion.current === version) {
        setThread((current) => ({
          ...current,
          exchanges: [...current.exchanges, { question, answer: answer.answer, ts: answer.ts }].slice(-24),
          pendingQuestion: null,
        }));
      }
    } catch (error) {
      if (requestVersion.current === version) {
        setThread((current) => ({
          ...current,
          pendingQuestion: null,
          failedQuestion: question,
          failure: error instanceof OpenClawSessionCompanionBusyError
            ? 'busy'
            : error instanceof OpenClawSessionCompanionUnavailableError
              ? 'unavailable'
              : 'invalid',
        }));
      }
    }
  }, [active, sessionKey]);

  const reset = useCallback(async () => {
    const key = sessionKey.trim();
    if (!active || !key) return false;
    const version = ++requestVersion.current;
    setThread((current) => ({ ...current, loading: true, failure: null, failedQuestion: null }));
    try {
      await openClawSessionCompanionClient.reset(key);
      if (requestVersion.current === version) setThread(EMPTY_THREAD);
      return true;
    } catch (error) {
      if (requestVersion.current === version) {
        setThread((current) => ({
          ...current,
          loading: false,
          failure: error instanceof OpenClawSessionCompanionUnavailableError ? 'unavailable' : 'invalid',
        }));
      }
      return false;
    }
  }, [active, sessionKey]);

  useEffect(() => {
    requestVersion.current += 1;
    setThread(EMPTY_THREAD);
    if (active && sessionKey.trim()) void refresh();
  }, [active, refresh, sessionKey]);

  useEffect(() => () => {
    requestVersion.current += 1;
  }, []);

  return { ...thread, setDraft, ask, refresh, reset };
}
