import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getDirection } from '@/i18n';

// ═══════════════════════════════════════════════════════════
// Typing Indicator — smooth animated dots
// ═══════════════════════════════════════════════════════════

export function TypingIndicator() {
  const { t } = useTranslation();
  const { language } = useSettingsStore();
  const agents = useGatewayDataStore((s) => s.agents);
  const activeSessionKey = useChatStore((s) => s.activeSessionKey);
  const dir = getDirection(language);
  const activeAgentId = (() => {
    if (!activeSessionKey) return 'main';
    const parts = activeSessionKey.split(':');
    return parts[0] === 'agent' && parts[1] ? parts[1] : 'main';
  })();
  const activeAgentName =
    agents.find((a) => a.id === activeAgentId)?.name
    || (activeAgentId === 'main' ? t('agents.mainAgent', 'Main Agent') : activeAgentId);
  const activeAgentLetter = activeAgentName.charAt(0) || 'M';

  return (
    <div className="group flex gap-2.5 items-start mx-1 mr-4 mb-2 animate-fade-in" dir={dir}>
      {/* Avatar */}
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-aegis-primary to-aegis-accent flex items-center justify-center shrink-0 mt-0.5 shadow-sm ring-1 ring-white/5">
        <span className="text-[10px] font-bold text-white">{activeAgentLetter}</span>
      </div>

      {/* Dots container — aligned with assistant message content column */}
      <div className="flex flex-col min-w-0" style={{ width: '100%', maxWidth: 'min(640px, 72%)', alignItems: 'flex-start' }}>
        <div className="inline-flex items-center gap-1.5 select-none px-3 py-2 rounded-xl border border-aegis-primary/25 bg-[color-mix(in_srgb,rgb(var(--aegis-primary))_14%,rgb(var(--aegis-elevated)))] shadow-[0_0_18px_rgb(var(--aegis-primary)/0.12)]">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="inline-block rounded-full"
              style={{
                width: i === 1 ? 7 : 6,
                height: i === 1 ? 7 : 6,
                background: i === 1
                  ? 'rgb(var(--aegis-primary))'
                  : 'color-mix(in srgb, rgb(var(--aegis-primary)) 62%, rgb(var(--aegis-text)) 18%)',
                boxShadow: i === 1 ? '0 0 10px rgb(var(--aegis-primary)/0.45)' : 'none',
                animation: `typing-dot 1.15s ease-in-out ${i * 0.16}s infinite`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
