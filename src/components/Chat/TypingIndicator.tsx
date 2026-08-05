import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { selectActiveSessionTyping, useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getDirection } from '@/i18n';
import { AssistantResponseAvatar } from './MessageBubble';

// ═══════════════════════════════════════════════════════════
// Typing Indicator — smooth animated dots + elapsed-time chip
// Visual style matches the assistant bubble's outer container so the
// indicator reads as a "live bubble" rather than a separate pill.
// ═══════════════════════════════════════════════════════════

export function TypingIndicator() {
  const { t } = useTranslation();
  const { language } = useSettingsStore();
  const activeSessionKey = useChatStore((s) => s.activeSessionKey);
  const isTyping = useChatStore(selectActiveSessionTyping);
  const typingStartedAt = useChatStore((s) => s.typingStartedAtBySession[s.activeSessionKey]);
  const gatewayTiming = useChatStore((s) => s.chatSendTimingBySession[s.activeSessionKey]);
  const dir = getDirection(language);

  // The store owns the start instant. This keeps elapsed time truthful when
  // the footer remounts while a response is still running.
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

  // Adaptive format: under a minute reads as "Ns" (3s, 12s, 59s); at
  // and beyond one minute it flips to "m:ss" (1:00, 1:23, 10:00). The
  // flip avoids the visual jump from "59s" to "60s" and gives a stable
  // width once the agent has been waiting for a while.
  const formatElapsed = (sec: number): string => {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const timingPhase = gatewayTiming ? t(`chat.responseTiming.${gatewayTiming.phase}`) : null;
  const timingMs = gatewayTiming ? Math.round(gatewayTiming.receivedToPhaseMs) : null;

  return (
    <div className="group flex gap-2.5 items-start mx-1 mr-4 mb-2.5 animate-fade-in" dir={dir}>
      {/* Avatar — identical size/style to MessageBubble assistant avatar */}
      <AssistantResponseAvatar sessionKey={activeSessionKey} />

      {/* Indicator + timer row — same width column + border treatment as
          the assistant bubble so the indicator visually reads as a
          small live bubble attached to the same avatar column.
          Vertical padding py-2.5 matches MessageBubble's py-2.5 so
          the indicator row sits at the same baseline height as a
          single-line bubble. */}
      <div className="flex flex-col min-w-0" style={{ width: '100%', maxWidth: 'min(640px, 72%)', alignItems: 'flex-start' }}>
        <div className="inline-flex items-stretch select-none rounded-xl
          bg-[rgb(var(--aegis-overlay)/0.03)] border border-[rgb(var(--aegis-overlay)/0.06)]
          hover:bg-[rgb(var(--aegis-overlay)/0.06)]
          shadow-[inset_1px_0_0_rgb(var(--aegis-primary)/0.18)]">
          {/* Dots pill — py-2.5 + slightly larger dots to fill the bubble-height slot */}
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
                  animation: `typing-dot 1.15s ease-in-out ${i * 0.16}s infinite`,
                }}
              />
            ))}
          </div>
          {/* Elapsed-time chip — py-2.5 so it matches the dots pill height via items-stretch.
              Hidden for the first second so a fresh indicator doesn't
              flash "0s". Format adapts: Ns under a minute, m:ss beyond. */}
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
