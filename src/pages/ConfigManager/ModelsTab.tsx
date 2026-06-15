// ═══════════════════════════════════════════════════════════
// Config Manager — ModelsTab
// Visual model management: list / set primary / edit alias / add / discover
// ═══════════════════════════════════════════════════════════

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Star, Plus, Trash2, RefreshCw, Loader2, Search } from 'lucide-react';
import clsx from 'clsx';
import type { GatewayRuntimeConfig, ModelEntry } from './types';

interface ModelsTabProps {
  config: GatewayRuntimeConfig;
  onChange: (updater: (prev: GatewayRuntimeConfig) => GatewayRuntimeConfig) => void;
  saving: boolean;
}

interface DiscoveredModel {
  id: string;
  provider: string;
  providerId: string;
  name?: string;
  input?: string[];
  alreadyAdded: boolean;
}

export function ModelsTab({ config, onChange, saving }: ModelsTabProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [newModelId, setNewModelId] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [showDiscovered, setShowDiscovered] = useState(false);

  const allModels = config?.agents?.defaults?.models ?? {};
  const primaryModel = config?.agents?.defaults?.model?.primary;
  const providers = config?.models?.providers ?? {};

  // Discover models from providers' static catalogs
  const discoveredModels = useMemo<DiscoveredModel[]>(() => {
    const configuredIds = new Set(Object.keys(allModels));
    const out: DiscoveredModel[] = [];
    for (const [providerId, provCfg] of Object.entries(providers)) {
      const provModels = (provCfg as any)?.models;
      if (!Array.isArray(provModels)) continue;
      for (const m of provModels) {
        const rawId = typeof m === 'string' ? m : (m?.id ?? m?.model ?? '');
        if (!rawId) continue;
        const fullId = rawId.includes('/') ? rawId : `${providerId}/${rawId}`;
        out.push({
          id: fullId,
          provider: providerId,
          providerId,
          name: typeof m === 'object' ? m?.name : undefined,
          input: typeof m === 'object' ? m?.input : undefined,
          alreadyAdded: configuredIds.has(fullId),
        });
      }
    }
    return out;
  }, [providers, allModels]);

  const modelEntries = useMemo(() => {
    return Object.entries(allModels)
      .filter(([id]) => !search.trim() || id.toLowerCase().includes(search.toLowerCase()) || (allModels[id]?.alias || '').toLowerCase().includes(search.toLowerCase()))
      .sort(([a], [b]) => {
        // Keep openclaw.json file order (Object.entries preserves insertion order for string keys)
        return 0;
      });
  }, [allModels, search]);

  // ── Mutations ──
  const updateModels = (updater: (prev: Record<string, ModelEntry>) => Record<string, ModelEntry>) => {
    onChange((prev) => ({
      ...prev,
      agents: {
        ...prev.agents,
        defaults: {
          ...prev.agents?.defaults,
          models: updater(prev.agents?.defaults?.models ?? {}),
        },
      },
    }));
  };

  const setPrimary = (modelId: string) => {
    onChange((prev) => ({
      ...prev,
      agents: {
        ...prev.agents,
        defaults: {
          ...prev.agents?.defaults,
          model: { ...prev.agents?.defaults?.model, primary: modelId },
        },
      },
    }));
  };

  const setAlias = (modelId: string, alias: string) => {
    updateModels((prev) => ({ ...prev, [modelId]: { ...prev[modelId], alias: alias || undefined } }));
  };

  const addModel = (modelId: string) => {
    const id = modelId.trim();
    if (!id) return;
    updateModels((prev) => prev[id] ? prev : { ...prev, [id]: { alias: '' } });
    setNewModelId('');
  };

  const removeModel = (modelId: string) => {
    updateModels((prev) => {
      const next = { ...prev };
      delete next[modelId];
      return next;
    });
    if (modelId === primaryModel) {
      onChange((prev) => ({
        ...prev,
        agents: { ...prev.agents, defaults: { ...prev.agents?.defaults, model: { ...prev.agents?.defaults?.model, primary: undefined } } },
      }));
    }
  };

  const handleDiscover = () => {
    setDiscovering(true);
    // Simulate brief loading for UX (models are already in config, just revealing)
    setTimeout(() => { setDiscovering(false); setShowDiscovered(true); }, 600);
  };

  const filteredDiscovered = showDiscovered ? discoveredModels.filter((m) => {
    if (m.alreadyAdded) return false;
    if (!search.trim()) return true;
    return m.id.toLowerCase().includes(search.toLowerCase());
  }) : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Primary model highlight */}
      <div className="rounded-xl border border-aegis-primary/20 bg-aegis-primary/5 px-5 py-3.5">
        <div className="flex items-center gap-2 text-xs text-aegis-text-muted mb-1.5">
          <Star size={14} className="text-aegis-warning" />
          <span className="font-bold uppercase tracking-wider">{t('config.currentPrimary', 'Current Primary Model')}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-base font-mono text-aegis-text">{primaryModel || t('config.notSet', 'Not set')}</span>
          {primaryModel && allModels[primaryModel]?.alias && (
            <span className="text-xs text-aegis-text-muted">({allModels[primaryModel].alias})</span>
          )}
        </div>
      </div>

      {/* Add model + discover */}
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2">
          <input
            value={newModelId}
            onChange={(e) => setNewModelId(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addModel(newModelId); }}
            disabled={saving}
            placeholder={t('config.addModelPlaceholder', 'provider/model-id (e.g. openai/gpt-5)')}
            className="flex-1 rounded-lg border border-aegis-border bg-aegis-surface px-3 py-2 text-sm text-aegis-text placeholder:text-aegis-text-muted outline-none focus:border-aegis-primary/40"
          />
          <button
            onClick={() => addModel(newModelId)}
            disabled={saving || !newModelId.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-aegis-primary/10 px-3 py-2 text-xs font-medium text-aegis-primary hover:bg-aegis-primary/20 disabled:opacity-30 transition-colors"
          >
            <Plus size={14} /> {t('common.add', 'Add')}
          </button>
        </div>
        <button
          onClick={handleDiscover}
          disabled={saving || discovering || discoveredModels.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-aegis-border px-3 py-2 text-xs font-medium text-aegis-text-muted hover:text-aegis-text hover:bg-aegis-surface disabled:opacity-30 transition-colors"
          title={t('config.discoverModels', 'Discover models from providers')}
        >
          {discovering ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {t('config.discover', 'Discover')}
        </button>
      </div>

      {/* Discovered models (from provider catalogs) */}
      {showDiscovered && filteredDiscovered.length > 0 && (
        <div className="rounded-xl border border-aegis-accent/20 bg-aegis-accent/5 overflow-hidden">
          <div className="px-5 py-2.5 border-b border-aegis-accent/15">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-aegis-text-muted">
              {t('config.discoveredFromProviders', 'Discovered from Providers')} ({filteredDiscovered.length})
            </h4>
          </div>
          <div className="max-h-[200px] overflow-y-auto scrollbar-thin divide-y divide-aegis-border/30">
            {filteredDiscovered.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-5 py-2 hover:bg-aegis-surface/50 transition-colors">
                <span className="text-[10px] font-mono text-aegis-text-dim shrink-0 w-16 truncate">{m.provider}</span>
                <span className="text-xs font-mono text-aegis-text flex-1 truncate">{m.id}</span>
                {m.name && <span className="text-[10px] text-aegis-text-muted truncate max-w-[120px]">{m.name}</span>}
                {m.input?.includes('image') && <span className="text-[9px] text-aegis-accent font-bold">IMG</span>}
                <button
                  onClick={() => addModel(m.id)}
                  disabled={saving}
                  className="shrink-0 rounded-md bg-aegis-primary/10 px-2 py-1 text-[10px] font-medium text-aegis-primary hover:bg-aegis-primary/20 transition-colors"
                >
                  + {t('common.add', 'Add')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-aegis-text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('config.searchModels', 'Search models…')}
          className="w-full rounded-lg border border-aegis-border bg-aegis-surface pl-9 pr-3 py-2 text-sm text-aegis-text placeholder:text-aegis-text-muted outline-none focus:border-aegis-primary/40"
        />
      </div>

      {/* Model list */}
      <div className="rounded-xl border border-aegis-border bg-aegis-elevated overflow-hidden">
        <div className="px-5 py-3 border-b border-aegis-border">
          <h3 className="text-xs font-bold uppercase tracking-widest text-aegis-text-secondary">
            {t('config.allModels', 'All Models')} ({modelEntries.length})
          </h3>
        </div>
        <div className="divide-y divide-aegis-border/40">
          {modelEntries.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-aegis-text-muted">
              {t('config.noModels', 'No models configured. Add a provider first.')}
            </div>
          ) : modelEntries.map(([id, entry]) => {
            const isPrimary = id === primaryModel;
            const provider = id.split('/')[0] || '';
            return (
              <div key={id} className="flex items-center gap-3 px-5 py-3 transition-colors group">
                {/* Star / Set primary */}
                <button
                  onClick={() => !saving && setPrimary(id)}
                  disabled={saving}
                  className={clsx('shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all', isPrimary ? 'bg-aegis-warning/15 text-aegis-warning' : 'text-aegis-text-dim hover:text-aegis-warning hover:bg-aegis-warning/10')}
                  title={isPrimary ? t('config.primaryModel') : t('config.setAsPrimary', 'Set as primary')}
                >
                  <Star size={14} fill={isPrimary ? 'currentColor' : 'none'} />
                </button>

                {/* Model ID + provider */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-aegis-text truncate">{id}</span>
                    {entry.supportsImage && <span className="text-[9px] uppercase font-bold text-aegis-accent px-1.5 py-0.5 rounded bg-aegis-accent/10">IMG</span>}
                  </div>
                  <div className="text-[10px] text-aegis-text-dim">{provider}</div>
                </div>

                {/* Alias input */}
                <input
                  value={entry.alias ?? ''}
                  onChange={(e) => setAlias(id, e.target.value)}
                  disabled={saving}
                  placeholder={t('config.aliasPlaceholder', 'Display name')}
                  className="w-28 rounded-md border border-aegis-border bg-aegis-surface px-2 py-1 text-[11px] text-aegis-text placeholder:text-aegis-text-dim outline-none focus:border-aegis-primary/30"
                />

                {/* Delete */}
                <button
                  onClick={() => !saving && removeModel(id)}
                  disabled={saving}
                  className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-aegis-text-dim hover:text-aegis-danger hover:bg-aegis-danger/10 opacity-0 group-hover:opacity-100 transition-all"
                  title={t('common.remove', 'Remove')}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
