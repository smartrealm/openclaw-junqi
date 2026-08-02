// ═══════════════════════════════════════════════════════════
// Config Manager — Secrets Tab
// Read-only configured secret provider view
// ═══════════════════════════════════════════════════════════

import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
import clsx from 'clsx';
import type { GatewayRuntimeConfig } from './types';
import { ExpandableCard } from './components';

interface SecretsTabProps {
  config: GatewayRuntimeConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider badge color by type
// ─────────────────────────────────────────────────────────────────────────────

function providerBadgeClass(type: string): string {
  switch (type) {
    case 'env':  return 'bg-blue-400/10 text-blue-400 border-blue-400/20';
    case 'file': return 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20';
    case 'exec': return 'bg-purple-400/10 text-purple-400 border-purple-400/20';
    default:     return 'bg-aegis-elevated text-aegis-text-muted border-aegis-border';
  }
}

function providerType(cfg: Record<string, unknown>): string {
  if ('command' in cfg || 'exec' in cfg) return 'exec';
  if ('file' in cfg || 'path' in cfg)    return 'file';
  return 'env';
}

export function SecretsTab({ config }: SecretsTabProps) {
  const { t } = useTranslation();
  const providers = ((config as Record<string, unknown>).secrets as Record<string, unknown> | undefined)?.providers ?? {};
  const providerEntries = Object.entries(providers as Record<string, Record<string, unknown>>);

  return (
    <div className="space-y-4">
      <ExpandableCard
        title={t('secrets.providers.title', 'Secret Providers')}
        subtitle={t('secrets.providers.subtitle', 'Configured sources for secret resolution (read-only — edit via Advanced → Raw JSON)')}
        icon={<KeyRound size={15} />}
        defaultExpanded
        badge={
          providerEntries.length > 0 ? (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-aegis-primary/10 text-aegis-primary border border-aegis-primary/20">
              {providerEntries.length}
            </span>
          ) : undefined
        }
      >
        {providerEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
            <KeyRound size={24} className="text-aegis-text-muted" />
            <p className="text-sm text-aegis-text-muted">{t('secrets.providers.emptyTitle', 'No secret providers configured')}</p>
            <p className="text-xs text-aegis-text-muted">
              {t('secrets.providers.emptyHintPrefix', 'Add providers under')}{' '}
              <code className="font-mono bg-aegis-elevated px-1 rounded">secrets.providers</code>{' '}
              {t('secrets.providers.emptyHintSuffix', 'in the Advanced tab')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {providerEntries.map(([name, cfg]) => {
              const type = providerType(cfg);
              return (
                <div
                  key={name}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-aegis-border bg-aegis-surface hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <KeyRound size={13} className="text-aegis-text-muted shrink-0" />
                    <span className="text-sm font-mono text-aegis-text truncate">{name}</span>
                  </div>
                  <span
                    className={clsx(
                      'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border shrink-0',
                      providerBadgeClass(type)
                    )}
                  >
                    {type}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </ExpandableCard>
    </div>
  );
}

export default SecretsTab;
