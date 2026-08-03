import { useTranslation } from 'react-i18next';
import { AlertCircle, ChevronDown, LoaderCircle, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { useToolsCatalog } from '@/hooks/useToolsCatalog';
import type { ToolCatalogGroup, ToolCatalogRisk, ToolCatalogSource } from '@/services/gateway/toolsCatalog';

interface ToolsCatalogPanelProps {
  enabled?: boolean;
}

const SOURCE_KEYS: Record<ToolCatalogSource, string> = {
  core: 'core',
  plugin: 'plugin',
};

const RISK_KEYS: Record<ToolCatalogRisk, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
};

function countTools(groups: ToolCatalogGroup[]): number {
  return groups.reduce((total, group) => total + group.tools.length, 0);
}

export function ToolsCatalogPanel({ enabled = true }: ToolsCatalogPanelProps) {
  const { t } = useTranslation();
  const { result, loading, error, refresh } = useToolsCatalog(undefined, true, enabled);
  const total = result ? countTools(result.groups) : 0;

  return (
    <section className="rounded-xl border border-aegis-border bg-aegis-elevated p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-aegis-text">{t('config.toolsCatalog.title', 'Runtime tool catalog')}</h3>
          <p className="mt-1 text-xs text-aegis-text-muted">{t('config.toolsCatalog.description', 'Read-only catalog from the selected OpenClaw Runtime. It describes configurable tools, not session availability.')}</p>
        </div>
        <button
          type="button"
          onClick={() => { void refresh(); }}
          disabled={loading}
          className="grid size-7 shrink-0 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text disabled:cursor-wait disabled:opacity-50"
          title={t('config.toolsCatalog.refresh', 'Refresh catalog')}
          aria-label={t('config.toolsCatalog.refresh', 'Refresh catalog')}
        >
          <RefreshCw size={13} className={clsx(loading && 'animate-spin')} />
        </button>
      </div>

      <div className="mt-3">
        {loading && (
          <div className="flex items-center gap-2 py-4 text-xs text-aegis-text-muted">
            <LoaderCircle size={14} className="animate-spin" />
            <span>{t('config.toolsCatalog.loading', 'Loading the Runtime tool catalog...')}</span>
          </div>
        )}

        {!loading && error && (
          <div className="space-y-2 rounded-md border border-aegis-danger/25 bg-aegis-danger/5 px-3 py-2.5 text-xs text-aegis-text-muted">
            <div className="flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-aegis-danger" />
              <span>{t('config.toolsCatalog.error', 'The Runtime tool catalog is unavailable.')}</span>
            </div>
            <div className="break-words text-[10px] text-aegis-text-dim">{error}</div>
            <button
              type="button"
              onClick={() => { void refresh(); }}
              className="rounded-md border border-aegis-border px-2 py-1 text-[10px] text-aegis-text-secondary transition-colors hover:border-aegis-border-hover hover:text-aegis-text"
            >
              {t('config.toolsCatalog.retry', 'Retry')}
            </button>
          </div>
        )}

        {!loading && !error && result && (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-aegis-text-dim">
              <span>{t('config.toolsCatalog.agent', { agentId: result.agentId })}</span>
              <span>{t('config.toolsCatalog.count', { count: total })}</span>
              <span>{t('config.toolsCatalog.groups', { count: result.groups.length })}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {result.profiles.map((profile) => (
                <span key={profile.id} className="rounded border border-aegis-border px-1.5 py-0.5 text-[10px] text-aegis-text-dim" title={profile.label}>
                  {profile.label}
                </span>
              ))}
            </div>
            {result.groups.length === 0 ? (
              <p className="py-4 text-center text-xs text-aegis-text-dim">{t('config.toolsCatalog.empty', 'No catalog tools were returned.')}</p>
            ) : (
              <div className="mt-3 space-y-1.5">
                {result.groups.map((group, index) => (
                  <details key={`${group.id}-${index}`} open={group.tools.length > 0} className="rounded-md border border-aegis-border">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-xs text-aegis-text-secondary [&::-webkit-details-marker]:hidden">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <ChevronDown size={12} className="shrink-0 text-aegis-text-dim" />
                        <span className="truncate">{group.label}</span>
                        <span className="text-[10px] text-aegis-text-dim">{t(`config.toolsCatalog.source.${SOURCE_KEYS[group.source]}`)}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-aegis-text-dim">{group.tools.length}</span>
                    </summary>
                    <div className="border-t border-aegis-border px-2.5 py-1">
                      {group.tools.map((tool) => (
                        <div key={tool.id} className="border-b border-[rgb(var(--aegis-overlay)/0.05)] py-2 last:border-b-0">
                          <div className="flex items-start justify-between gap-2">
                            <span className="min-w-0 truncate text-xs font-medium text-aegis-text" title={tool.description}>{tool.label}</span>
                            <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-aegis-text-dim">
                              {tool.optional && <span>{t('config.toolsCatalog.optional', 'Optional')}</span>}
                              {tool.risk && <span>{t(`config.toolsCatalog.risk.${RISK_KEYS[tool.risk]}`)}</span>}
                            </span>
                          </div>
                          <div className="mt-0.5 truncate font-mono text-[10px] text-aegis-text-dim" title={tool.id}>{tool.id}</div>
                          {tool.defaultProfiles.length > 0 && (
                            <div className="mt-1 text-[10px] text-aegis-text-dim">
                              {t('config.toolsCatalog.defaultProfiles', { profiles: tool.defaultProfiles.join(', ') })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
