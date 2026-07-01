/**
 * Channels settings panel — STUB.
 *
 * Per SPEC §6 M5: stub for IM channel integrations (Discord / Slack /
 * Telegram / Feishu / Lark). The runtime bridge will be added later; for
 * now this panel just renders an informational card.
 */
import { useTranslation } from 'react-i18next';
import { Radio } from 'lucide-react';
import { GlassCard } from '@/components/shared/GlassCard';

export function ChannelsPanel() {
  const { t } = useTranslation();
  return (
    <GlassCard>
      <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
        <Radio size={16} className="text-aegis-primary" />
        {t('settings.channels.title', 'Channels')}
      </h3>
      <div className="rounded-lg border border-aegis-border/20 bg-[rgb(var(--aegis-overlay)/0.02)] p-4 text-[12px] text-aegis-text-dim leading-relaxed">
        {t('settings.channels.stubHint', 'IM channel integrations (Discord, Slack, Telegram, Feishu, Lark) — coming soon. Per-channel tokens and routing rules land in a follow-up milestone.')}
      </div>
    </GlassCard>
  );
}