/**
 * Models settings panel — STUB.
 *
 * Per SPEC §6 M5 (Settings 分区扩展): the 4 new tabs (Models / Channels /
 * MCP / Workspace) ship as non-crashing stubs. Real data wiring is a future
 * milestone.
 *
 * This component is mounted as a sub-route at /settings/models.
 */
import { useTranslation } from 'react-i18next';
import { Cpu } from 'lucide-react';
import { GlassCard } from '@/components/shared/GlassCard';

export function ModelsPanel() {
  const { t } = useTranslation();
  return (
    <GlassCard>
      <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
        <Cpu size={16} className="text-aegis-primary" />
        {t('settings.models.title', 'Models')}
      </h3>
      <div className="rounded-lg border border-aegis-border/20 bg-[rgb(var(--aegis-overlay)/0.02)] p-4 text-[12px] text-aegis-text-dim leading-relaxed">
        {t('settings.models.stubHint', 'Model provider catalog (Anthropic / OpenAI / Google / local) — coming soon. Default model and per-provider API key vault land in a follow-up milestone.')}
      </div>
    </GlassCard>
  );
}