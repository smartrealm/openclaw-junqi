/**
 * MCP settings panel — STUB.
 *
 * Per SPEC §6 M5: stub for MCP (Model Context Protocol) server list. The
 * runtime that talks to MCP servers is a future milestone.
 */
import { useTranslation } from 'react-i18next';
import { Server } from 'lucide-react';
import { GlassCard } from '@/components/shared/GlassCard';

export function McpPanel() {
  const { t } = useTranslation();
  return (
    <GlassCard>
      <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
        <Server size={16} className="text-aegis-primary" />
        {t('settings.mcp.title', 'MCP Servers')}
      </h3>
      <div className="rounded-lg border border-aegis-border/20 bg-[rgb(var(--aegis-overlay)/0.02)] p-4 text-[12px] text-aegis-text-dim leading-relaxed">
        {t('settings.mcp.stubHint', 'Model Context Protocol server registry — coming soon. Add / enable / disable / restart controls and per-server tool permissions land in a follow-up milestone.')}
      </div>
    </GlassCard>
  );
}