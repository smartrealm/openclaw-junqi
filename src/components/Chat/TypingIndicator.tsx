import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReducedMotion } from 'framer-motion';
import { selectActiveSessionTyping, useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getDirection } from '@/i18n';
import { AssistantResponseAvatar } from './MessageBubble';

// 输入状态与智能体气泡保持同一视觉边界，避免把运行阶段误读为独立消息。

export function TypingIndicator() {
  const { t } = useTranslation();
  const { language } = useSettingsStore();
  const activeSessionKey = useChatStore((s) => s.activeSessionKey);
  const isTyping = useChatStore(selectActiveSessionTyping);
  const typingStartedAt = useChatStore((s) => s.typingStartedAtBySession[s.activeSessionKey]);
  const runStartup = useChatStore((s) => s.chatRunStartupBySession[s.activeSessionKey]);
  const gatewayTiming = useChatStore((s) => s.chatSendTimingBySession[s.activeSessionKey]);
  const dir = getDirection(language);
  const reduceMotion = useReducedMotion() ?? false;

  // 起始时间由会话状态持有，组件重挂载时仍能显示真实耗时。
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!isTyping || !typingStartedAt) {
      setElapsedSec(0);
      return;
    }
    const updateElapsed = () => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - typingStartedAt) / 1000)));
    };
    updateElapsed();
    const id = setInterval(() => {
      updateElapsed();
    }, 1000);
    return () => clearInterval(id);
  }, [isTyping, typingStartedAt]);

  // 一分钟内显示秒数，超过一分钟后改为分秒格式以保持宽度稳定。
  const formatElapsed = (sec: number): string => {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const timingPhase = gatewayTiming ? t(`chat.responseTiming.${gatewayTiming.phase}`) : null;
  const timingMs = gatewayTiming ? Math.round(gatewayTiming.receivedToPhaseMs) : null;
  const startupLabel = runStartup ? t(`chat.runStartup.${runStartup.phase}`) : null;

  return (
    <div className="group flex gap-2.5 items-start mx-1 mr-4 mb-2.5" dir={dir}>
      <AssistantResponseAvatar sessionKey={activeSessionKey} />

      <div className="flex flex-col min-w-0" style={{ width: '100%', maxWidth: 'min(640px, 72%)', alignItems: 'flex-start' }}>
        <div className="inline-flex items-stretch select-none rounded-xl
          bg-[rgb(var(--aegis-overlay)/0.03)] border border-[rgb(var(--aegis-overlay)/0.06)]
          hover:bg-[rgb(var(--aegis-overlay)/0.06)]
          shadow-[inset_1px_0_0_rgb(var(--aegis-primary)/0.18)]"
          role="status"
          aria-live="polite"
          aria-label={startupLabel ?? t('chat.sessionWorking')}
        >
          <div className="flex items-center gap-1.5 px-3 py-2.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="inline-block rounded-full"
                style={{
                  width: i === 1 ? 8 : 7,
                  height: i === 1 ? 8 : 7,
                  background: i === 1
                    ? 'rgb(var(--aegis-primary))'
                    : 'color-mix(in srgb, rgb(var(--aegis-primary)) 62%, rgb(var(--aegis-text)) 18%)',
                  boxShadow: i === 1 ? '0 0 10px rgb(var(--aegis-primary)/0.45)' : 'none',
                  animation: reduceMotion ? undefined : `typing-dot 1.15s ease-in-out ${i * 0.16}s infinite`,
                }}
              />
            ))}
            {startupLabel && (
              <span className="ml-1 text-xs text-aegis-text-secondary">{startupLabel}</span>
            )}
          </div>
          {isTyping && elapsedSec >= 1 && (
            <div className="flex items-center px-2.5 py-2.5 border-l border-[rgb(var(--aegis-overlay)/0.06)]
              text-[10px] font-mono tabular-nums text-aegis-text-dim">
              {formatElapsed(elapsedSec)}
            </div>
          )}
        </div>
        {timingPhase && timingMs !== null && (
          <div className="mt-1.5 px-1 text-[10px] text-aegis-text-dim" aria-live="polite">
            {t('chat.responseTiming.detail', { phase: timingPhase, ms: timingMs })}
          </div>
        )}
      </div>
    </div>
  );
}
